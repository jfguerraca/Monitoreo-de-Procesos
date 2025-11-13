import React, { useState, useEffect, useCallback, useMemo } from 'react';
// Importaciones de Firebase para un entorno estándar de React/Vite
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, doc, onSnapshot, setDoc, collection
} from 'firebase/firestore';

// --- CONFIGURACIÓN GLOBAL FIREBASE (Necesaria para despliegue en Netlify) ---
// RECUERDA: EN TU ARCHIVO LOCAL DEBES REEMPLAZAR ESTOS VALORES CON TUS CLAVES REALES DE FIREBASE.
const appId = 'utt-industrial-monitor'; 
const firebaseConfig = { 
    apiKey: "AIzaSyAvym-YOj79nDdM8D9VCDNmCtg3YP2_huw", // Clave de Firebase
    authDomain: "utt-industrial-monitor.firebaseapp.com",
    projectId: "utt-industrial-monitor",
    storageBucket: "utt-industrial-monitor.firebasestorage.app",
    messagingSenderId: "502532134151",
    appId: "1:502532134151:web:0480ad315feeac96da61a2"
};
const initialAuthToken = null; // No necesario para despliegue estándar

// Mapa de Matrículas a Nombres y Estaciones
const STUDENT_MAP = {
    '22010183': { name: 'Álvarez Nanguse Edgar Alejandro', station: 1 },
    '22010160': { name: 'Ávila Quezada Dayana Berenice', station: 2 },
    '22010138': { name: 'Bejarano Juárez Daniel', station: 3 },
    '21030190': { name: 'Campos Contreras Bianca Rebeca', station: 4 },
    '22010146': { name: 'Carlos Oyervides Liliana', station: 5 },
    '22010145': { name: 'De Leon García Danna Karen', station: 6 },
    '21030204': { name: 'Escobedo Rocha Arely Yadira', station: 7 },
    '22010125': { name: 'Escobedo Sifuentes Desiree', station: 8 },
    '22010055': { name: 'Espitia Trejo Génesis Aleli', station: 9 },
    '22010189': { name: 'García Del Toro Alan Alexander', station: 10 },
    '22010192': { name: 'Gutiérrez Godina Kenya Fernanda', station: 11 },
    '22010108': { name: 'Jaramillo Vázquez Ariel Elizabeth', station: 12 },
    '21010117': { name: 'Juárez Mata Jaime', station: 13 },
    '22020183': { name: 'Lara Ibarra Elver Alan', station: 14 },
    '22010128': { name: 'Martínez Fraga Jesús Manuel', station: 15 },
    '22010156': { name: 'Martínez Lavenant Ximena', station: 16 },
    '22010237': { name: 'Melendrez Landeros Michelle Idaly', station: 17 },
    '22010134': { name: 'Montoya Martínez Miguel Ángel', station: 18 },
    '20040088': { name: 'Narváez Juárez Leobardo Humberto', station: 19 },
    '21010112': { name: 'Palacios Hernández Leslie Iveth', station: 20 },
    '21170168': { name: 'Reyes Monsivais Ángel David', station: 21 },
    '20170007': { name: 'Reynoso Maldonado Luis Alberto', station: 22 },
    '21170183': { name: 'Ríos Alba Nicolás', station: 23 },
    '22010218': { name: 'Salazar Hernández Gerardo Emanuel', station: 24 },
    '22010096': { name: 'Segura Torres Jesús Alejandro', station: 25 },
    '22010250': { name: 'Villegas Vega Miguel Ángel', station: 26 },
};
const SUPERVISOR_MATRICULA = 'SUPERVISOR';

// Parámetros de Simulación
const MAX_LEVEL = 100; // Litros
const FILL_RATE = 10; // Litros/segundo
const HEAT_RATE = 2; // Grados/segundo
const MIX_TIME = 5; // Segundos
const PURGE_RATE = 20; // Litros/segundo
const MAX_TIME_PER_BATCH = 30; // Segundos (Límite de tiempo)

// Estructura Inicial de la Estación
const initialStationState = (matricula, name, stationNumber) => ({
    operatorName: name,
    matricula: matricula,
    stationNumber: stationNumber,
    batchCount: 0,
    errorCount: 0,
    
    // Sensores y Actuadores
    levelA: 0, // Nivel de líquido A
    levelB: 0, // Nivel de líquido B
    currentTemp: 25, // Temperatura actual (ambiente)
    
    pumpAOn: false,
    pumpBOn: false,
    heaterOn: false,
    motorOn: false,
    purgePumpOn: false,
    
    // Estado del Batch
    batchActive: false,
    step: 'IDLE', // IDLE, FILLING, HEATING, MIXING, PURGING
    batchStartTime: null,
    
    // Parámetros del Supervisor
    supervisorParams: {
        proportionA: 0.5,
        proportionB: 0.5,
        targetTemp: 50,
        purgeTemp: 30,
        targetLevel: MAX_LEVEL
    }
});

// --- COMPONENTES AUXILIARES ---

const StatusIndicator = ({ on, label }) => (
    <div className={`p-2 rounded-lg text-center font-bold text-xs transition duration-300 ${on 
        ? 'bg-green-500 text-white shadow-md' 
        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
    }`}>
        {label}
    </div>
);

const Gauge = ({ value, label, max, unit, color }) => {
    const percentage = (value / max) * 100;
    const barColor = color || 'bg-blue-500';

    return (
        <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-3 md:h-4 overflow-hidden shadow-inner">
            <div 
                className={`h-full rounded-full ${barColor} transition-all duration-500`} 
                style={{ width: `${Math.min(100, percentage)}%` }}
            ></div>
            <div className="text-center mt-1 text-sm text-gray-700 dark:text-gray-300">
                {label}: <span className="font-semibold">{value.toFixed(1)}{unit}</span>
            </div>
        </div>
    );
};

const ButtonActuator = ({ label, on, onClick, disabled, color = 'bg-indigo-600 hover:bg-indigo-700' }) => (
    <button 
        onClick={onClick}
        disabled={disabled}
        className={`w-full py-3 px-4 rounded-lg text-white font-semibold transition duration-200 shadow-lg ${disabled ? 'opacity-50 cursor-not-allowed' : color} 
                    ${on ? 'ring-4 ring-offset-2 ring-opacity-75 ring-green-400' : ''}`}
    >
        {label} <span className="ml-2">({on ? 'ON' : 'OFF'})</span>
    </button>
);

const MetricCard = ({ label, value, unit, status, color }) => (
    <div className="flex justify-between items-center py-2 border-b dark:border-gray-600">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</span>
        <div className="flex items-center space-x-2">
            <span className={`text-lg font-bold ${color || 'text-gray-900 dark:text-white'}`}>{value} {unit}</span>
            {status && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status === 'OK' || status === 'ON' ? 'bg-green-200 text-green-800' : status === 'Bajo' ? 'bg-yellow-200 text-yellow-800' : 'bg-red-200 text-red-800'}`}>
                    {status}
                </span>
            )}
        </div>
    </div>
);

const TankDisplay = ({ levelA, levelB, maxLevel, temp }) => {
    const totalLevel = levelA + levelB;
    const height = (totalLevel / maxLevel) * 100;
    
    let heightA_perc = 0;
    if (totalLevel > 0) {
        heightA_perc = (levelA / totalLevel) * 100;
    }

    const colorA = '#3b82f6'; // blue-500
    const colorB = '#f97316'; // orange-500
    
    const liquidStyle = {
        height: `${height}%`,
        background: `linear-gradient(to top, ${colorA} 0%, ${colorA} ${heightA_perc}% ${heightA_perc > 0 ? `, ` : ''}${colorB} ${heightA_perc}%, ${colorB} 100%)`,
        boxShadow: '0 -10px 15px rgba(0,0,0,0.3) inset',
        borderRadius: '0 0 10px 10px'
    };

    const tempColor = temp < 30 ? 'bg-blue-300' : temp < 60 ? 'bg-yellow-400' : 'bg-red-500';

    return (
        <div className="relative w-40 h-80 border-4 border-gray-400 dark:border-gray-300 rounded-xl bg-gray-200 dark:bg-gray-900 shadow-2xl">
            <div className="absolute bottom-0 left-0 w-full transition-all duration-100 ease-linear" style={liquidStyle}></div>
            
            <div className={`absolute top-2 w-full h-1 ${totalLevel >= maxLevel * 0.95 ? 'bg-red-600' : 'bg-gray-500'} transition-colors duration-500`}></div>
            <div className="absolute top-2 -right-14 text-xs text-gray-700 dark:text-gray-300">Nivel Alto ({MAX_LEVEL} L)</div>

            <div className={`absolute bottom-20 w-full h-1 ${totalLevel < maxLevel * 0.2 ? 'bg-red-600' : 'bg-gray-500'} transition-colors duration-500`}></div>
            <div className="absolute bottom-20 -right-14 text-xs text-gray-700 dark:text-gray-300">Nivel Bajo</div>

            <div className="absolute right-[-70px] top-1/2 -translate-y-1/2 w-4 h-24 bg-gray-300 rounded-full shadow-lg overflow-hidden">
                <div 
                    className={`absolute bottom-0 w-full ${tempColor} transition-all duration-500`} 
                    style={{ height: `${Math.min(100, (temp / 100) * 100)}%` }} 
                ></div>
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-black opacity-30"></div>
            </div>
        </div>
    );
};

const ParamInput = ({ label, name, value, onChange, min, max, step }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
        </label>
        <input
            id={name}
            name={name}
            type="number"
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
    </div>
);

const PerformanceList = ({ title, stations, showPerf = false }) => (
    <div className="space-y-2">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{title}</h3>
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {stations.map((s, index) => (
                <li key={s.id} className="py-2 flex justify-between items-center text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{index + 1}. Est. {s.stationNumber} ({s.operatorName})</span>
                    <div className="flex items-center space-x-2">
                        <span className="text-indigo-600 dark:text-indigo-400">
                            {s.batchCount} lotes | {s.errorCount} errores
                        </span>
                        {showPerf && (
                             <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full font-bold">
                                Perf: {(s.batchCount / (s.errorCount + 1)).toFixed(1)}
                            </span>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    </div>
);

const MonitorDetails = ({ station }) => (
    <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 md:col-span-1 space-y-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="xl font-bold mb-2 dark:text-white">Actuadores (ON/OFF)</h3>
            <StatusIndicator on={station.pumpAOn} label="Bomba A" />
            <StatusIndicator on={station.pumpBOn} label="Bomba B" />
            <StatusIndicator on={station.heaterOn} label="Calentador" />
            <StatusIndicator on={station.motorOn} label="Motor Mezcla" />
            <StatusIndicator on={station.purgePumpOn} label="Bomba Purga" />
        </div>
        
        <div className="col-span-2 md:col-span-1 space-y-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="xl font-bold mb-2 dark:text-white">Sensores y Estado</h3>
            <Gauge value={station.levelA} label="Nivel A" max={station.supervisorParams.targetLevel} unit="L" color="bg-blue-500" />
            <Gauge value={station.levelB} label="Nivel B" max={station.supervisorParams.targetLevel} unit="L" color="bg-orange-500" />
            <Gauge value={station.levelA + station.levelB} label="Nivel Total" max={MAX_LEVEL} unit="L" color="bg-purple-500" />
            <p className="text-lg font-bold text-gray-800 dark:text-white pt-2">
                Temp: <span className={station.currentTemp >= station.supervisorParams.targetTemp ? 'text-green-500' : 'text-yellow-500'}>
                    {station.currentTemp.toFixed(1)}°C
                </span>
            </p>
            <p className="text-lg font-bold text-gray-800 dark:text-white">
                Paso Actual: <span className="text-indigo-500">{station.step}</span>
            </p>
        </div>
    </div>
);

const DemoStationCard = ({ station }) => {
    const totalLevel = station.levelA + station.levelB;
    const isError = station.errorCount > 0;
    
    return (
        <div className={`p-6 rounded-xl shadow-xl transition duration-300 ${isError ? 'bg-red-50 dark:bg-red-900 border-4 border-red-500' : 'bg-white dark:bg-gray-800'}`}>
            <h3 className="text-2xl font-bold mb-2 flex justify-between items-center">
                Estación {station.stationNumber}
                <span className={`text-sm font-semibold px-3 py-1 rounded-full ${isError ? 'bg-red-600 text-white' : 'bg-green-200 text-green-800'}`}>
                    {station.step}
                </span>
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{station.operatorName}</p>
            
            <div className="space-y-2 text-gray-700 dark:text-gray-300">
                <p>Nivel Total: <span className="font-semibold">{totalLevel.toFixed(1)} L</span></p>
                <p>Temperatura: <span className="font-semibold">{station.currentTemp.toFixed(1)}°C</span></p>
                <p>Lotes Completados: <span className="font-semibold text-green-600">{station.batchCount}</span></p>
                <p>Errores Históricos: <span className="font-semibold text-red-600">{station.errorCount}</span></p>
            </div>
            
            <div className="mt-4 grid grid-cols-3 gap-2">
                <StatusIndicator on={station.pumpAOn} label="Bomba A" />
                <StatusIndicator on={station.pumpBOn} label="Bomba B" />
                <StatusIndicator on={station.heaterOn} label="Calentador" />
                <StatusIndicator on={station.motorOn} label="Motor" />
                <StatusIndicator on={station.purgePumpOn} label="Purga" />
            </div>
        </div>
    );
};

const LoadingScreen = ({ message }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-gray-600 dark:text-gray-400">
        <svg className="animate-spin h-8 w-8 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="mt-3 text-lg font-medium">{message}</p>
    </div>
);


// --- PÁGINA DE LOGIN ---

const LoginPage = ({ onLogin, onDemo, onDemoOperator, studentMap }) => {
    const [showError, setShowError] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        const inputMatricula = e.target.matricula.value.toUpperCase();
        
        if (inputMatricula === SUPERVISOR_MATRICULA || studentMap[inputMatricula]) {
            onLogin(e); 
        } else {
            setShowError(true);
            setTimeout(() => setShowError(false), 3000); 
        }
    }

    return (
        <div className="max-w-md mx-auto bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl space-y-6">
            <div className="flex justify-center mb-4">
                <img 
                    src="https://utt.edu.mx/formatos/LOGOS(PNG)/UTTcompletoverticalRGB.png" 
                    alt="Logo Universidad Tecnológica de Torreón" 
                    className="h-16 object-contain"
                    onError={(e) => { e.target.onerror = null; e.target.src="https://placehold.co/150x64/3b82f6/ffffff?text=UTT+Logo"; }}
                />
            </div>
            
            <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white text-center">
                Acceso al Sistema
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="matricula" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Matrícula de Operador o Código de Supervisor
                    </label>
                    <input
                        id="matricula"
                        name="matricula"
                        type="text"
                        required
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="Ej. 22010183 o SUPERVISOR"
                    />
                </div>
                {showError && (
                    <div className="p-3 bg-red-100 text-red-800 rounded-lg text-sm font-medium transition duration-300">
                        Matrícula no encontrada. Verifique la lista.
                    </div>
                )}
                <button
                    type="submit"
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150"
                >
                    Acceder
                </button>
            </form>
            
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <button
                        onClick={onDemo}
                        className="flex justify-center py-3 px-2 border border-transparent rounded-lg shadow-lg text-sm font-medium text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150"
                    >
                        Demostración Supervisor
                    </button>
                    <button
                        onClick={onDemoOperator}
                        className="flex justify-center py-3 px-2 border border-transparent rounded-lg shadow-lg text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-150"
                    >
                        Demostración Operador
                    </button>
                </div>
                
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mt-4">
                    Operadores Disponibles ({Object.keys(studentMap).length})
                </h3>
                <ul className="divide-y divide-gray-200 dark:divide-gray-700 max-h-48 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    {Object.entries(studentMap).map(([matricula, data]) => (
                        <li key={matricula} className="py-2 flex justify-between text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">{data.name}</span>
                            <span className="text-indigo-600 dark:text-indigo-400">{matricula}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};


// --- PÁGINA OPERADOR (Vista Reutilizable) ---

const OperatorView = ({ station, feedback, FeedbackStyle, totalLevel, proportionText, tempStatus, levelStatus, toggleActuator, handleStartBatch, handleStopBatch, onLogout, isDemo = false }) => {
    
    return (
        <div className="max-w-4xl mx-auto space-y-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3 mb-3 dark:border-gray-700">
                <div>
                    <h2 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{station.operatorName}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Estación: {station.stationNumber} | Matrícula: {station.matricula}</p>
                </div>
                <button 
                    onClick={onLogout}
                    className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-600 transition"
                >
                    {isDemo ? 'Salir de Demo' : 'Salir'}
                </button>
            </div>
            
            <div className={`p-3 rounded-lg font-medium text-center ${FeedbackStyle[feedback.type]}`}>
                {feedback.message}
            </div>

            <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-lg border border-indigo-200 dark:border-indigo-700">
                <h3 className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">
                    Parámetros del Lote ({station.step})
                </h3>
                <div className="flex flex-wrap text-sm mt-2 text-gray-700 dark:text-gray-300">
                    <span className="w-1/2 md:w-1/4">Proporción A: <span className="font-bold">{(station.supervisorParams.proportionA * 100).toFixed(0)}%</span></span>
                    <span className="w-1/2 md:w-1/4">Temp. Mezcla: <span className="font-bold">{station.supervisorParams.targetTemp}°C</span></span>
                    <span className="w-1/2 md:w-1/4">Proporción B: <span className="font-bold">{(station.supervisorParams.proportionB * 100).toFixed(0)}%</span></span>
                    <span className="w-1/2 md:w-1/4">Temp. Purga Máx: <span className="font-bold">{station.supervisorParams.purgeTemp}°C</span></span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1 space-y-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-inner order-2 lg:order-1">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-3">Actuadores</h3>
                    <ButtonActuator 
                        label="Bomba A (Llenado)" 
                        on={station.pumpAOn} 
                        onClick={() => toggleActuator('pumpAOn', !station.pumpAOn)}
                        disabled={!station.batchActive || station.step !== 'FILLING'}
                    />
                    <ButtonActuator 
                        label="Bomba B (Llenado)" 
                        on={station.pumpBOn} 
                        onClick={() => toggleActuator('pumpBOn', !station.pumpBOn)}
                        disabled={!station.batchActive || station.step !== 'FILLING'}
                    />
                    <ButtonActuator 
                        label="Calentador" 
                        on={station.heaterOn} 
                        onClick={() => toggleActuator('heaterOn', !station.heaterOn)}
                        disabled={!station.batchActive || (station.step !== 'HEATING' && station.step !== 'MIXING')}
                    />
                    <ButtonActuator 
                        label="Motor de Mezcla" 
                        on={station.motorOn} 
                        onClick={() => toggleActuator('motorOn', !station.motorOn)}
                        disabled={!station.batchActive || (station.step !== 'HEATING' && station.step !== 'MIXING')}
                    />
                    <ButtonActuator 
                        label="Bomba Purga" 
                        on={station.purgePumpOn} 
                        onClick={() => toggleActuator('purgePumpOn', !station.purgePumpOn)}
                        disabled={!station.batchActive || station.step !== 'PURGING'}
                        color="bg-red-600 hover:bg-red-700"
                    />
                </div>

                <div className="lg:col-span-1 flex flex-col items-center justify-center p-4 bg-gray-100 dark:bg-gray-700 rounded-lg shadow-2xl order-1 lg:order-2">
                    <TankDisplay 
                        levelA={station.levelA} 
                        levelB={station.levelB} 
                        maxLevel={MAX_LEVEL}
                        temp={station.currentTemp}
                    />
                    <div className="mt-4 text-center">
                        <p className="text-lg font-semibold text-gray-800 dark:text-white">Total: {totalLevel.toFixed(1)} L</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{proportionText}</p>
                    </div>
                </div>

                <div className="lg:col-span-1 space-y-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-inner order-3">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-3">Sensores y Métricas</h3>
                    <MetricCard label="Flow A (L/s)" value={station.pumpAOn ? FILL_RATE.toFixed(1) : 0} unit="L/s" status={station.pumpAOn ? 'ON' : 'OFF'} />
                    <MetricCard label="Flow B (L/s)" value={station.pumpBOn ? FILL_RATE.toFixed(1) : 0} unit="L/s" status={station.pumpBOn ? 'ON' : 'OFF'} />
                    <MetricCard label="Flow Purga (L/s)" value={station.purgePumpOn ? PURGE_RATE.toFixed(1) : 0} unit="L/s" status={station.purgePumpOn ? 'ON' : 'OFF'} />
                    <MetricCard label="Temperatura (°C)" value={station.currentTemp.toFixed(1)} unit="°C" status={tempStatus} />
                    <MetricCard label="Nivel Total (L)" value={totalLevel.toFixed(1)} unit="L" status={levelStatus} />
                    
                    <div className="pt-3 border-t dark:border-gray-600 space-y-1">
                        <MetricCard label="Lotes Correctos" value={station.batchCount} unit="lotes" color="text-green-600" />
                        <MetricCard label="Errores Cometidos" value={station.errorCount} unit="errores" color="text-red-600" />
                    </div>
                </div>
            </div>

            <div className="flex space-x-4 pt-4 border-t dark:border-gray-700">
                <button 
                    onClick={handleStartBatch} 
                    disabled={station.batchActive}
                    className="flex-1 py-3 px-4 rounded-lg shadow-md text-white font-bold transition duration-200 disabled:opacity-50 
                                bg-green-600 hover:bg-green-700 focus:ring-green-500 focus:ring-2 focus:ring-offset-2"
                >
                    <svg className="w-5 h-5 inline mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                    START
                </button>
                <button 
                    onClick={handleStopBatch} 
                    disabled={!station.batchActive}
                    className="flex-1 py-3 px-4 rounded-lg shadow-md text-white font-bold transition duration-200 disabled:opacity-50 
                                bg-red-600 hover:bg-red-700 focus:ring-red-500 focus:ring-2 focus:ring-offset-2"
                >
                    <svg className="w-5 h-5 inline mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm3 1a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    STOP
                </button>
            </div>
        </div>
    );
}

const OperatorPage = ({ db, userId, matricula, operatorData, getStationDocRef, onLogout }) => {
    const stationId = operatorData.station;
    const docRef = getStationDocRef(stationId);
    
    const [station, setStation] = useState(initialStationState(matricula, operatorData.name, stationId));
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState({ message: 'Presione START para comenzar un lote.', type: 'info' });

    useEffect(() => {
        if (!docRef || !userId) return;

        // Intentar crear el documento si no existe y luego suscribirse
        setDoc(docRef, initialStationState(matricula, operatorData.name, stationId), { merge: true })
            .then(() => {
                setLoading(false);
                const unsubscribe = onSnapshot(docRef, (docSnap) => {
                    if (docSnap.exists()) {
                        setStation(prev => ({ ...prev, ...docSnap.data() }));
                    } else {
                        setStation(initialStationState(matricula, operatorData.name, stationId));
                    }
                }, (error) => {
                    console.error("Error al suscribirse a Firestore:", error);
                    setFeedback({ message: 'Error de conexión con el monitor.', type: 'error' });
                });
                return () => unsubscribe();
            })
            .catch(e => {
                console.error("Error inicializando el documento:", e);
                setLoading(false);
            });
            
    }, [docRef, userId, matricula, operatorData]);
    
    const toggleActuator = useCallback(async (key, value) => {
        if (station.step !== 'IDLE' && station.step !== 'PURGING' && (key === 'pumpAOn' || key === 'pumpBOn' || key === 'purgePumpOn')) {
            setFeedback({ message: `No se puede modificar la bomba en el estado actual (${station.step}).`, type: 'warning' });
            return;
        }
        
        try {
            await setDoc(docRef, { [key]: value }, { merge: true });
        } catch (e) {
            console.error(`Error al actualizar ${key}:`, e);
            setFeedback({ message: `Error al intentar encender/apagar ${key}`, type: 'error' });
        }
    }, [docRef, station.step]);

    useEffect(() => {
        let interval;
        const targetTemp = station.supervisorParams.targetTemp;
        const { proportionA, proportionB, targetLevel } = station.supervisorParams;
        const totalProportion = proportionA + proportionB;
        
        if (station.batchActive) {
            interval = setInterval(async () => {
                let newLevelA = station.levelA;
                let newLevelB = station.levelB;
                let newTemp = station.currentTemp;
                let newStep = station.step;
                let errorOccurred = false;
                
                // Llenado
                if (newStep === 'FILLING') {
                    if (station.pumpAOn) { newLevelA = Math.min(targetLevel * proportionA / totalProportion, station.levelA + FILL_RATE * 0.1); }
                    if (station.pumpBOn) { newLevelB = Math.min(targetLevel * proportionB / totalProportion, station.levelB + FILL_RATE * 0.1); }
                    
                    if (newLevelA >= targetLevel * proportionA / totalProportion && newLevelB >= targetLevel * proportionB / totalProportion) {
                        newStep = 'HEATING';
                        setFeedback({ message: 'Llenado Completo. ¡Encienda el calentador y el motor!', type: 'success' });
                    }
                    
                    // Error: Overflow (si el operador llena de más)
                    if (newLevelA + newLevelB > MAX_LEVEL) {
                        errorOccurred = true;
                        setFeedback({ message: '¡ERROR! Desbordamiento de tanque.', type: 'error' });
                        newStep = 'IDLE';
                    }
                }
                
                // Calentamiento y Mezcla
                if (newStep === 'HEATING' && station.heaterOn && station.motorOn) {
                    newTemp = Math.min(targetTemp, newTemp + HEAT_RATE * 0.1);
                    if (newTemp >= targetTemp) {
                        newStep = 'MIXING';
                        setFeedback({ message: 'Temperatura Alcanzada. Mezcle por 5 segundos.', type: 'info' });
                    }
                } else if (newStep === 'HEATING' && (station.heaterOn || station.motorOn)) {
                     setFeedback({ message: 'Recuerde encender calentador y motor simultáneamente.', type: 'warning' });
                }
                
                // Finalizar Mezcla
                if (newStep === 'MIXING' && station.batchStartTime) {
                    const elapsed = (Date.now() - station.batchStartTime) / 1000;
                    if (station.currentTemp.toFixed(1) !== targetTemp.toFixed(1)) { // Comparación aproximada para evitar errores de float
                         errorOccurred = true;
                         setFeedback({ message: '¡ERROR! Temperatura cambiada durante la mezcla.', type: 'error' });
                         newStep = 'IDLE';
                    } else if (elapsed > MIX_TIME) {
                        newStep = 'PURGING';
                        setFeedback({ message: 'Mezcla lista. ¡Proceda a purgar con la temperatura de vaciado correcta!', type: 'success' });
                    }
                }
                
                // Purga
                if (newStep === 'PURGING') {
                    if (station.purgePumpOn) {
                        newLevelA = Math.max(0, newLevelA - PURGE_RATE * 0.1 / 2);
                        newLevelB = Math.max(0, newLevelB - PURGE_RATE * 0.1 / 2);
                        newTemp = Math.max(25, newTemp - HEAT_RATE * 0.1); 
                        
                        // Error: Purga a temperatura incorrecta
                        if (newTemp > station.supervisorParams.purgeTemp) {
                            errorOccurred = true;
                            setFeedback({ message: `¡ERROR! Temperatura de purga demasiado alta (${newTemp.toFixed(1)}°C).`, type: 'error' });
                            newStep = 'IDLE';
                        }
                    }
                    
                    if (newLevelA <= 0 && newLevelB <= 0) {
                        newStep = 'IDLE';
                        setFeedback({ message: 'Lote Correcto. Presione START para el siguiente.', type: 'success' });
                    }
                }
                
                // Límite de Tiempo (30 segundos)
                if (station.batchStartTime && (Date.now() - station.batchStartTime) / 1000 > MAX_TIME_PER_BATCH) {
                    errorOccurred = true;
                    setFeedback({ message: `¡ERROR! Tiempo límite (${MAX_TIME_PER_BATCH}s) excedido.`, type: 'error' });
                    newStep = 'IDLE';
                }
                
                // Persistencia de Estado
                const update = {
                    levelA: newLevelA,
                    levelB: newLevelB,
                    currentTemp: newTemp,
                    step: newStep,
                    batchActive: newStep !== 'IDLE',
                };
                
                if (errorOccurred) {
                    update.errorCount = station.errorCount + 1;
                    update.batchActive = false;
                    update.pumpAOn = false; update.pumpBOn = false; update.heaterOn = false; update.motorOn = false; update.purgePumpOn = false;
                }
                
                if (newStep === 'IDLE' && station.batchActive) {
                    update.batchCount = station.batchCount + (errorOccurred ? 0 : 1);
                    update.batchStartTime = null;
                }
                
                await setDoc(docRef, update, { merge: true });

            }, 100); // 100ms de actualización (10 veces/segundo)
        }

        return () => clearInterval(interval);
    }, [station, docRef]);
    
    const handleStartBatch = async () => {
        if (station.batchActive) {
            setFeedback({ message: 'Un lote ya está activo. Use STOP si es necesario.', type: 'warning' });
            return;
        }

        const initialState = initialStationState(matricula, operatorData.name, stationId);

        try {
            await setDoc(docRef, { 
                ...initialState,
                batchCount: station.batchCount, 
                errorCount: station.errorCount,
                supervisorParams: station.supervisorParams,
                batchActive: true,
                step: 'FILLING',
                batchStartTime: Date.now(),
            }, { merge: true });
            setFeedback({ message: 'Lote iniciado. ¡Comience el llenado!', type: 'info' });
        } catch (e) {
            console.error("Error al iniciar lote:", e);
            setFeedback({ message: 'Error al intentar iniciar el lote.', type: 'error' });
        }
    };
    
    const handleStopBatch = async () => {
        if (!station.batchActive) return;

        try {
            await setDoc(docRef, { 
                batchActive: false,
                step: 'IDLE',
                batchStartTime: null,
                pumpAOn: false, pumpBOn: false, purgePumpOn: false, heaterOn: false, motorOn: false 
            }, { merge: true });
            setFeedback({ message: 'Lote detenido por el operador.', type: 'info' });
        } catch (e) {
            console.error("Error al detener lote:", e);
        }
    };

    if (loading) return <LoadingScreen message="Conectando estación..." />;

    const totalLevel = station.levelA + station.levelB;
    const proportionText = totalLevel > 0 
        ? `A: ${Math.round(station.levelA / totalLevel * 100)}% / B: ${Math.round(station.levelB / totalLevel * 100)}%`
        : 'A: 0% / B: 0%';
    const tempStatus = station.currentTemp >= station.supervisorParams.targetTemp ? 'OK' : 'Bajo';
    const levelStatus = totalLevel >= station.supervisorParams.targetLevel * 0.95 ? 'Alto' : 'Bajo';

    const FeedbackStyle = {
        'info': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        'success': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        'warning': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        'error': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };

    return (
        <OperatorView 
            station={station} 
            feedback={feedback} 
            FeedbackStyle={FeedbackStyle} 
            totalLevel={totalLevel} 
            proportionText={proportionText} 
            tempStatus={tempStatus} 
            levelStatus={levelStatus} 
            toggleActuator={toggleActuator} 
            handleStartBatch={handleStartBatch} 
            handleStopBatch={handleStopBatch} 
            onLogout={onLogout}
        />
    );
};


// --- PÁGINA DEMO OPERADOR ---
const DemoOperatorPage = ({ db, getStationDocRef, onExit }) => {
    const stationId = 99;
    const matricula = 'DEMO_OP';
    const operatorName = 'Operador Demo (Automático)';
    const docRef = getStationDocRef(stationId);
    
    const [station, setStation] = useState(initialStationState(matricula, operatorName, stationId));
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState({ message: 'Modo Demo Operador. El proceso se ejecuta automáticamente.', type: 'info' });

    useEffect(() => {
        if (!docRef) return;
        
        const initialState = initialStationState(matricula, operatorName, stationId);
        initialState.supervisorParams = { proportionA: 0.6, proportionB: 0.4, targetTemp: 65, purgeTemp: 40, targetLevel: MAX_LEVEL };

        setDoc(docRef, initialState, { merge: true })
            .then(() => {
                setLoading(false);
                const unsubscribe = onSnapshot(docRef, (docSnap) => {
                    if (docSnap.exists()) {
                        setStation(docSnap.data());
                    }
                }, (error) => {
                    console.error("Error al suscribirse a Firestore (Demo):", error);
                    setFeedback({ message: 'Error de conexión con el monitor.', type: 'error' });
                });
                return () => unsubscribe();
            })
            .catch(e => {
                console.error("Error inicializando el documento (Demo):", e);
                setLoading(false);
            });
    }, [docRef]);

    useEffect(() => {
        let interval;
        const { proportionA, proportionB, targetTemp, purgeTemp, targetLevel } = station.supervisorParams;
        const totalProportion = proportionA + proportionB;
        const targetLevelA = targetLevel * proportionA / totalProportion;
        const targetLevelB = targetLevel * proportionB / totalProportion;

        const updateStation = async (updates) => {
            await setDoc(docRef, updates, { merge: true });
        };
        
        if (!loading) {
            interval = setInterval(() => {
                let updates = {};
                let currentStep = station.step;

                switch (currentStep) {
                    case 'IDLE':
                        updates.batchActive = true;
                        updates.step = 'FILLING';
                        updates.batchStartTime = Date.now();
                        updates.errorCount = 0; 
                        setFeedback({ message: 'Lote iniciado automáticamente. Fase: Llenado.', type: 'info' });
                        break;
                    
                    case 'FILLING':
                        updates.pumpAOn = station.levelA < targetLevelA;
                        updates.pumpBOn = station.levelB < targetLevelB;

                        if (station.levelA >= targetLevelA && station.levelB >= targetLevelB) {
                            updates.pumpAOn = false; updates.pumpBOn = false; updates.step = 'HEATING';
                            setFeedback({ message: 'Llenado Completo. Fase: Calentamiento/Mezcla.', type: 'success' });
                        }
                        break;
                        
                    case 'HEATING':
                        updates.heaterOn = station.currentTemp < targetTemp;
                        updates.motorOn = true;
                        
                        if (station.currentTemp >= targetTemp) {
                            updates.step = 'MIXING';
                            setFeedback({ message: 'Temperatura Alcanzada. Fase: Mezclando.', type: 'info' });
                        }
                        break;
                        
                    case 'MIXING':
                        updates.heaterOn = true; 
                        updates.motorOn = true;

                        if (station.batchStartTime && (Date.now() - station.batchStartTime) / 1000 > MIX_TIME) {
                            updates.heaterOn = false; 
                            updates.motorOn = false;
                            updates.step = 'PURGING';
                            setFeedback({ message: 'Mezcla lista. Fase: Purga.', type: 'success' });
                        }
                        break;
                        
                    case 'PURGING':
                         updates.heaterOn = false;
                         updates.motorOn = false;

                         if (station.currentTemp <= purgeTemp) {
                             updates.purgePumpOn = true;
                         }

                         if (station.levelA <= 0 && station.levelB <= 0) {
                             updates.purgePumpOn = false;
                             updates.batchActive = false;
                             updates.step = 'IDLE'; 
                             updates.batchCount = station.batchCount + 1; 
                             setFeedback({ message: `¡Lote Correcto! Completado: ${station.batchCount + 1}`, type: 'success' });
                         }
                         break;
                }
                
                // Simulación física (replicada)
                let newLevelA = station.levelA;
                let newLevelB = station.levelB;
                let newTemp = station.currentTemp;

                if (currentStep === 'FILLING') {
                    if (updates.pumpAOn) { newLevelA = Math.min(targetLevelA, station.levelA + FILL_RATE * 0.1); }
                    if (updates.pumpBOn) { newLevelB = Math.min(targetLevelB, station.levelB + FILL_RATE * 0.1); }
                }
                if (currentStep === 'HEATING' || currentStep === 'MIXING') {
                    if (updates.heaterOn) { newTemp = Math.min(targetTemp, station.currentTemp + HEAT_RATE * 0.1); }
                }
                if (currentStep === 'PURGING') {
                    if (updates.purgePumpOn) {
                        newLevelA = Math.max(0, station.levelA - PURGE_RATE * 0.1 / 2);
                        newLevelB = Math.max(0, station.levelB - PURGE_RATE * 0.1 / 2);
                        newTemp = Math.max(25, station.currentTemp - HEAT_RATE * 0.1); 
                    }
                }
                
                updates = { ...updates, levelA: newLevelA, levelB: newLevelB, currentTemp: newTemp };
                if (Object.keys(updates).length > 0) {
                    updateStation(updates);
                }

            }, 100); 
        }

        return () => clearInterval(interval);
    }, [station, loading, docRef]); 

    if (loading) return <LoadingScreen message="Inicializando demo de operador..." />;

    const totalLevel = station.levelA + station.levelB;
    const proportionText = totalLevel > 0 
        ? `A: ${Math.round(station.levelA / totalLevel * 100)}% / B: ${Math.round(station.levelB / totalLevel * 100)}%`
        : 'A: 0% / B: 0%';
    const tempStatus = station.currentTemp >= station.supervisorParams.targetTemp ? 'OK' : 'Bajo';
    const levelStatus = totalLevel >= station.supervisorParams.targetLevel * 0.95 ? 'Alto' : 'Bajo';

    const FeedbackStyle = {
        'info': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        'success': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        'warning': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        'error': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };

    const toggleActuator = () => {
        setFeedback({ message: '¡Demo activo! Los controles son solo visuales.', type: 'warning' });
    };
    const handleStartBatch = () => {
        setFeedback({ message: '¡Demo activo! El ciclo se inicia automáticamente.', type: 'warning' });
    };
    const handleStopBatch = async () => {
         await setDoc(docRef, { batchActive: false, step: 'IDLE' }, { merge: true });
    };

    return (
        <OperatorView 
            station={station} 
            feedback={feedback} 
            FeedbackStyle={FeedbackStyle} 
            totalLevel={totalLevel} 
            proportionText={proportionText} 
            tempStatus={tempStatus} 
            levelStatus={levelStatus} 
            toggleActuator={toggleActuator} 
            handleStartBatch={handleStartBatch} 
            handleStopBatch={handleStopBatch} 
            onLogout={onExit}
            isDemo={true}
        />
    );
};


// --- PÁGINA SUPERVISOR ---

const SupervisorPage = ({ db, userId, getStationDocRef, onLogout }) => {
    const [allStations, setAllStations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeStationId, setActiveStationId] = useState(null);
    const [newParams, setNewParams] = useState({ 
        proportionA: 0.5, proportionB: 0.5, targetTemp: 50, purgeTemp: 30 
    });

    useEffect(() => {
        if (!db || !userId) return;

        const collectionRef = collection(db, `artifacts/${appId}/public/data/stations`);
        const unsubscribe = onSnapshot(collectionRef, (snapshot) => {
            const stationsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAllStations(stationsData);
            setLoading(false);

            if (stationsData.length > 0) {
                const currentStationId = activeStationId || stationsData[0].stationNumber;
                const currentStation = stationsData.find(s => s.stationNumber === currentStationId);
                
                setActiveStationId(currentStationId);
                
                if (currentStation) {
                    setNewParams(currentStation.supervisorParams || newParams);
                } else if (!activeStationId) {
                    setActiveStationId(stationsData[0].stationNumber);
                    setNewParams(stationsData[0].supervisorParams || newParams);
                }
            } else {
                setActiveStationId(null);
            }

        }, (error) => {
            console.error("Error fetching all stations:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, userId, activeStationId]);
    
    const handleParamChange = (e) => {
        let { name, value } = e.target;
        value = parseFloat(value);
        setNewParams(prev => ({ 
            ...prev, 
            [name]: isNaN(value) ? prev[name] : value 
        }));
    };
    
    const applyParameters = async () => {
        if (!activeStationId) {
            console.error('Error: Seleccione una estación primero.');
            return;
        }
        
        const totalProp = newParams.proportionA + newParams.proportionB;
        if (totalProp.toFixed(2) != 1.00) {
            console.error('Error: La suma de las proporciones A y B debe ser 1.0 (o 100%). Ajuste los valores.');
            return;
        }

        const docRef = getStationDocRef(activeStationId);
        try {
            await setDoc(docRef, { supervisorParams: newParams }, { merge: true });
            console.log(`Parámetros actualizados para Estación ${activeStationId}.`);
        } catch (e) {
            console.error("Error al aplicar parámetros:", e);
        }
    };
    
    const sortedStations = useMemo(() => {
        const completedStations = allStations.filter(s => s.batchCount > 0);
        const byErrors = [...completedStations].sort((a, b) => a.errorCount - b.errorCount);
        const byPerformance = [...allStations].sort((a, b) => (b.batchCount / (b.errorCount + 1)) - (a.batchCount / (a.errorCount + 1)));

        return {
            topErrors: byErrors.slice(0, 3),
            topPerformance: byPerformance.slice(0, 3)
        };
    }, [allStations]);

    if (loading) return <LoadingScreen message="Cargando panel de control..." />;
    
    const activeStation = allStations.find(s => s.stationNumber === activeStationId);

    return (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 text-gray-900 dark:text-gray-100">
            <div className="xl:col-span-1 space-y-6">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-lg">
                    <h2 className="text-xl font-bold mb-3 border-b pb-2 dark:border-gray-700">Estaciones Activas ({allStations.length})</h2>
                    <ul className="space-y-2 max-h-96 overflow-y-auto">
                        {allStations.map(station => (
                            <li 
                                key={station.id}
                                onClick={() => { 
                                    setActiveStationId(station.stationNumber);
                                    setNewParams(station.supervisorParams);
                                }}
                                className={`p-3 rounded-lg cursor-pointer transition duration-150 flex justify-between items-center ${activeStationId === station.stationNumber ? 'bg-indigo-200 dark:bg-indigo-600 font-bold' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                            >
                                <span>{station.stationNumber}: {station.operatorName}</span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${station.batchActive ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white'}`}>
                                    {station.batchActive ? 'Activo' : 'IDLE'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-lg space-y-4">
                    <h2 className="text-xl font-bold border-b pb-2 dark:border-gray-700">Rankings de Rendimiento</h2>
                    <PerformanceList title="Top Lotes/Error (Eficiencia)" stations={sortedStations.topPerformance} showPerf={true} />
                    <PerformanceList title="Menos Errores" stations={sortedStations.topErrors} />
                </div>
                <button 
                    onClick={onLogout}
                    className="w-full py-2 px-4 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition"
                >
                    Cerrar Sesión
                </button>
            </div>

            <div className="xl:col-span-2 space-y-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
                    <h2 className="2xl font-bold mb-4 text-indigo-600 dark:text-indigo-400">
                        Monitor Detallado: Estación {activeStationId || '-'}
                    </h2>
                    {activeStation ? (
                        <MonitorDetails station={activeStation} />
                    ) : (
                        <p className="text-gray-500 dark:text-gray-400">Seleccione una estación para ver el detalle en tiempo real.</p>
                    )}
                </div>
            </div>

            <div className="xl:col-span-1 space-y-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
                    <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white border-b pb-2 dark:border-gray-700">
                        Control de Parámetros
                    </h2>
                    <form className="space-y-4">
                        <ParamInput label="Proporción Líquido A (0.0 a 1.0)" name="proportionA" value={newParams.proportionA} onChange={handleParamChange} min={0} max={1} step={0.01} />
                        <ParamInput label="Proporción Líquido B (0.0 a 1.0)" name="proportionB" value={newParams.proportionB} onChange={handleParamChange} min={0} max={1} step={0.01} />
                        <ParamInput label="Temp. Mezclado (°C)" name="targetTemp" value={newParams.targetTemp} onChange={handleParamChange} min={25} max={100} step={1} />
                        <ParamInput label="Temp. Purga Máx (°C)" name="purgeTemp" value={newParams.purgeTemp} onChange={handleParamChange} min={25} max={100} step={1} />
                        <button
                            type="button"
                            onClick={applyParameters}
                            disabled={!activeStation}
                            className="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                        >
                            Aplicar Parámetros a Estación {activeStationId}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};


// --- PÁGINA DEMO SUPERVISOR ---

const SupervisorDemoPage = ({ db, getStationDocRef, onExit }) => {
    const demoStations = [101, 102, 103];
    const [stations, setStations] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db) return;
        
        demoStations.forEach(id => {
            const docRef = getStationDocRef(id);
            const demoState = initialStationState(`DEMO-${id}`, `Demo ${id}`, id);
            demoState.supervisorParams = {
                proportionA: id === 101 ? 0.7 : id === 102 ? 0.5 : 0.3,
                proportionB: id === 101 ? 0.3 : id === 102 ? 0.5 : 0.7,
                targetTemp: 60,
                purgeTemp: 35,
                targetLevel: MAX_LEVEL
            };
            setDoc(docRef, demoState, { merge: true });
        });
        
        const unsubscribes = demoStations.map(id => {
            const docRef = getStationDocRef(id);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    setStations(prev => ({ ...prev, [id]: docSnap.data() }));
                }
            });
        });

        setLoading(false);

        return () => unsubscribes.forEach(unsub => unsub());
    }, [db, getStationDocRef]);
    
    useEffect(() => {
        let interval;
        if (!loading && Object.keys(stations).length === demoStations.length) {
            interval = setInterval(() => {
                demoStations.forEach(async id => {
                    const station = stations[id];
                    if (!station) return;

                    if (station.step === 'IDLE' || station.errorCount > 0) {
                        const docRef = getStationDocRef(id);
                        const initialState = initialStationState(`DEMO-${id}`, `Demo ${id}`, id);
                        await setDoc(docRef, { 
                            ...initialState,
                            batchCount: (station?.batchCount || 0) + (station?.errorCount > 0 ? 0 : 1),
                            errorCount: station?.errorCount > 0 ? station.errorCount : 0,
                            supervisorParams: stations[id]?.supervisorParams || initialState.supervisorParams,
                            batchActive: true,
                            step: 'FILLING',
                            batchStartTime: Date.now(),
                        }, { merge: true });
                        return;
                    }

                    const docRef = getStationDocRef(id);
                    const { proportionA, proportionB, targetTemp, purgeTemp, targetLevel } = station.supervisorParams;
                    const totalProportion = proportionA + proportionB;
                    const targetLevelA = targetLevel * proportionA / totalProportion;
                    const targetLevelB = targetLevel * proportionB / totalProportion;

                    let update = {};

                    switch (station.step) {
                        case 'FILLING':
                            update.pumpAOn = station.levelA < targetLevelA;
                            update.pumpBOn = station.levelB < targetLevelB;
                            
                            if (station.levelA >= targetLevelA && station.levelB >= targetLevelB) {
                                update.pumpAOn = false; update.pumpBOn = false; update.step = 'HEATING';
                            }
                            break;
                        case 'HEATING':
                            update.heaterOn = station.currentTemp < targetTemp;
                            update.motorOn = true;
                            if (station.currentTemp >= targetTemp) {
                                update.step = 'MIXING';
                            }
                            break;
                        case 'MIXING':
                            update.heaterOn = true; 
                            update.motorOn = true;
                            if (station.batchStartTime && (Date.now() - station.batchStartTime) / 1000 > MIX_TIME) {
                                update.heaterOn = false; 
                                update.motorOn = false;
                                update.step = 'PURGING';
                            }
                            break;
                        case 'PURGING':
                             if (station.currentTemp <= purgeTemp) {
                                 update.purgePumpOn = true;
                             }
                             if (station.levelA <= 0 && station.levelB <= 0) {
                                 update.purgePumpOn = false;
                                 update.batchActive = false;
                                 update.step = 'IDLE'; 
                             }
                             break;
                        default:
                            break;
                    }
                    
                    if (Object.keys(update).length > 0) {
                        await setDoc(docRef, update, { merge: true });
                    }
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [db, loading, stations, getStationDocRef]);

    if (loading) return <LoadingScreen message="Inicializando simulación de demo..." />;
    
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center pb-4 border-b dark:border-gray-700">
                <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
                    Monitor de Estaciones Demo (Automatizadas)
                </h1>
                <button 
                    onClick={onExit}
                    className="py-2 px-4 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition"
                >
                    Salir de Demo
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {demoStations.map(id => stations[id] && (
                    <DemoStationCard key={id} station={stations[id]} />
                ))}
            </div>
        </div>
    );
};


// --- COMPONENTE PRINCIPAL DE LA APLICACIÓN (APP) ---

const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [userRole, setUserRole] = useState('guest'); 
    const [matricula, setMatricula] = useState('');
    const [operatorData, setOperatorData] = useState(null); 
    const [initError, setInitError] = useState(null);

    useEffect(() => {
        let authUnsubscribe = () => {};

        try {
            // Verifica si la configuración de Firebase es válida antes de inicializar
            if (Object.keys(firebaseConfig).length === 0 || !firebaseConfig.projectId || firebaseConfig.apiKey.includes('TU_API_KEY')) {
                 setInitError("ERROR: La configuración de Firebase está vacía. Reemplace los marcadores de posición con sus claves API reales.");
                 return;
            }

            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);
            
            setDb(firestore);
            setAuth(authInstance);

            const authenticate = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(authInstance, initialAuthToken);
                    } else {
                        await signInAnonymously(authInstance);
                    }
                } catch (e) {
                    console.error("Error de autenticación inicial:", e);
                    setInitError("Error de autenticación. Verifique la configuración de Firebase y las reglas de seguridad.");
                }
            };
            
            authenticate();

            authUnsubscribe = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    setUserId(null);
                }
            });

        } catch (e) {
            console.error("Error al inicializar Firebase:", e);
            setInitError("Error crítico al inicializar Firebase. Revise su consola.");
        }

        return () => authUnsubscribe();
    }, []);

    const handleLogin = (e) => {
        e.preventDefault();
        const inputMatricula = e.target.matricula.value.toUpperCase();
        setMatricula(inputMatricula);

        if (inputMatricula === SUPERVISOR_MATRICULA) {
            setUserRole('supervisor');
        } else if (STUDENT_MAP[inputMatricula]) {
            setOperatorData(STUDENT_MAP[inputMatricula]);
            setUserRole('operator');
        } else {
            console.error("Matrícula no encontrada:", inputMatricula); 
            setMatricula('');
        }
    };
    
    const getStationDocRef = useCallback((stationId) => {
        if (!db) return null;
        // Ruta para datos públicos/colaborativos
        return doc(db, 
            `artifacts/${appId}/public/data/stations`, 
            `station_${stationId}`
        );
    }, [db]);

    const renderAppContent = () => {
        if (initError) {
            return (
                <div className="text-center p-8 bg-red-100 border-l-4 border-red-500 text-red-700 max-w-lg mx-auto rounded-lg shadow-lg">
                    <h2 className="text-xl font-bold mb-2">ERROR CRÍTICO</h2>
                    <p className="text-sm">
                        {initError}
                    </p>
                    <p className="mt-2 text-xs">Si está desplegando localmente o en Netlify, reemplace los valores de `firebaseConfig`.</p>
                </div>
            );
        }

        if (!db || !userId) {
            return <LoadingScreen message="Conectando y autenticando servicios..." />;
        }
        
        switch (userRole) {
            case 'operator':
                return <OperatorPage 
                    db={db} 
                    userId={userId} 
                    matricula={matricula} 
                    operatorData={operatorData} 
                    getStationDocRef={getStationDocRef}
                    onLogout={() => {setUserRole('guest'); setMatricula(''); setOperatorData(null);}}
                />;
            case 'supervisor':
                return <SupervisorPage 
                    db={db} 
                    userId={userId} 
                    getStationDocRef={getStationDocRef}
                    onLogout={() => {setUserRole('guest'); setMatricula('');}}
                />;
            case 'demo':
                return <SupervisorDemoPage 
                    db={db} 
                    getStationDocRef={getStationDocRef}
                    onExit={() => setUserRole('guest')}
                />;
            case 'demo_operator':
                return <DemoOperatorPage
                    db={db} 
                    getStationDocRef={getStationDocRef}
                    onExit={() => setUserRole('guest')}
                />;
            case 'guest':
            default:
                return <LoginPage 
                    onLogin={handleLogin} 
                    onDemo={() => setUserRole('demo')}
                    onDemoOperator={() => setUserRole('demo_operator')}
                    studentMap={STUDENT_MAP}
                />;
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col font-sans">
            <header className="bg-indigo-600 shadow-lg text-white p-4">
                <h1 className="text-xl md:text-2xl font-bold text-center">
                    Comunicaciones Industriales y Monitoreo de Procesos
                </h1>
            </header>
            <main className="flex-grow p-4 md:p-8">
                {renderAppContent()}
            </main>
        </div>
    );
};

export default App;