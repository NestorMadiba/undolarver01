
// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
// --- Actualización del SDK de Mercado Pago ---
// Se importan los componentes necesarios de la nueva versión del SDK.
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
// Render proporciona el puerto a través de una variable de entorno. Usamos 10000 como fallback.
const port = process.env.PORT || 10000;

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Configuración de la Base de Datos (SQLite) ---
const DB_PATH = process.env.RENDER ? '/data/database.db' : 'database.db';
let db;

async function initializeDatabase() {
    try {
        // --- NUEVO: Asegurarse de que el directorio de la DB exista ---
        // Esto es crucial para Render, ya que el disco persistente debe estar montado en /data
        const dbDir = path.dirname(DB_PATH);
        if (process.env.RENDER && !fs.existsSync(dbDir)) {
            console.log(`El directorio de la base de datos (${dbDir}) no existe. Intentando crearlo.`);
            try {
                fs.mkdirSync(dbDir, { recursive: true });
                console.log(`Directorio ${dbDir} creado.`);
            } catch (mkdirErr) {
                console.error(`Error crítico: No se pudo crear el directorio para la base de datos en ${dbDir}.`);
                console.error('Esto usualmente significa que el Disco Persistente no está configurado o montado correctamente en Render.');
                console.error('Por favor, verifica la configuración de Disks en tu servicio de Render.');
                throw mkdirErr; // Lanzar el error para que sea capturado por el catch principal
            }
        }

        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                has_paid BOOLEAN NOT NULL DEFAULT FALSE
            );
        `);
        console.log("Base de datos conectada y tabla 'users' asegurada.");
    } catch (err) {
        console.error("Error fatal al inicializar la base de datos:", err);
        // Si el error es de apertura, añadir un mensaje más específico para Render.
        if (err.code === 'SQLITE_CANTOPEN') {
             console.error("\n--- AYUDA PARA RENDER ---");
             console.error("El error 'SQLITE_CANTOPEN' casi siempre significa que el servidor no puede escribir en el archivo de la base de datos.");
             console.error("En Render, esto ocurre si el 'Disco Persistente' no está creado y montado en la ruta '/data'.");
             console.error("Por favor, ve a la pestaña 'Disks' de tu servicio en Render y asegúrate de tener un disco con 'Mount Path' en '/data'.");
             console.error("---------------------------\n");
        }
        process.exit(1); // Detiene el servidor si la DB no puede iniciarse
    }
}


// --- Configuración de Mercado Pago (Sintaxis v2.x) ---
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!mpAccessToken) {
    console.error("Error: La variable de entorno MERCADOPAGO_ACCESS_TOKEN no está definida.");
}
// Se inicializa el cliente con el access token.
const mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });


// --- Endpoints de la API ---

// 1. Registro de Usuario
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Todos los campos son requeridos.' });
    }

    try {
        const userExists = await db.get('SELECT * FROM users WHERE email = ?', email);
        if (userExists) {
            return res.status(409).json({ message: 'El correo electrónico ya está registrado.' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const result = await db.run(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            name, email, password_hash
        );

        const newUser = {
            id: result.lastID,
            name,
            email,
            has_paid: false
        };

        console.log('Usuario registrado:', newUser.email);
        res.status(201).json(newUser);
    } catch (error) {
        console.error("Error en /api/register:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 2. Inicio de Sesión de Usuario
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    try {
        const user = await db.get('SELECT * FROM users WHERE email = ?', email);
        if (!user) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        console.log('Usuario inició sesión:', user.email);
        res.status(200).json({
            id: user.id,
            name: user.name,
            email: user.email,
            has_paid: !!user.has_paid
        });
    } catch (error) {
        console.error("Error en /api/login:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 3. Creación de Preferencia de Pago en Mercado Pago
app.post('/api/create-payment-preference', async (req, res) => {
    const { userId, userEmail } = req.body;

    if (!userId || !userEmail) {
        return res.status(400).json({ message: 'La información del usuario es requerida para el pago.' });
    }
    
    let frontendUrl = (process.env.FRONTEND_URL || `http://127.0.0.1:5500`).trim();
    if (frontendUrl.endsWith('/')) {
        frontendUrl = frontendUrl.slice(0, -1);
    }
    const backendUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

    const preferenceBody = {
        items: [{
            title: 'Acceso a 10 Ideas de Negocio Exclusivas',
            description: 'Contenido digital con guías en PDF para emprender.',
            quantity: 1,
            unit_price: 1300,
            currency_id: 'ARS',
        }],
        payer: {
            email: userEmail,
        },
        external_reference: userId.toString(),
        back_urls: {
            success: `${frontendUrl}/index.html?status=approved`,
            failure: `${frontendUrl}/index.html?status=failure`,
            pending: `${frontendUrl}/index.html?status=pending`,
        },
        notification_url: `${backendUrl}/api/mp-webhook`,
        auto_return: 'approved',
    };

    try {
        // Se instancia la clase Preference con el cliente y se crea la preferencia.
        const preference = new Preference(mpClient);
        const result = await preference.create({ body: preferenceBody });
        
        console.log('Preferencia de pago creada:', result.id);
        res.status(201).json({
            id: result.id,
            init_point: result.init_point,
        });
    } catch (error) {
        console.error('Error al crear la preferencia de pago:', error);
        res.status(500).json({ message: 'Error del servidor al contactar Mercado Pago.' });
    }
});

// 4. Webhook para notificaciones de Mercado Pago
app.post('/api/mp-webhook', async (req, res) => {
    const { type, data } = req.body;

    if (type === 'payment') {
        try {
            // Se instancia la clase Payment y se obtiene la información del pago.
            const payment = new Payment(mpClient);
            const paymentInfo = await payment.get({ id: data.id });
            
            // Se accede a los datos directamente desde el objeto de respuesta.
            const paymentStatus = paymentInfo.status;
            const externalReference = paymentInfo.external_reference;

            if (paymentStatus === 'approved' && externalReference) {
                const userId = parseInt(externalReference, 10);
                await db.run('UPDATE users SET has_paid = TRUE WHERE id = ?', userId);
                console.log(`Pago aprobado para usuario ID ${userId}. Acceso concedido.`);
            }
        } catch (error) {
            console.error('Error procesando el webhook de Mercado Pago:', error);
            return res.sendStatus(500);
        }
    }
    res.sendStatus(200);
});

// --- Iniciar el Servidor ---
initializeDatabase().then(() => {
    // Bind to 0.0.0.0 para asegurar accesibilidad en contenedores como Render.
    app.listen(port, '0.0.0.0', () => {
        console.log(`Servidor escuchando en http://0.0.0.0:${port}`);
        if (process.env.FRONTEND_URL) console.log(`URL del Frontend configurada: ${process.env.FRONTEND_URL}`);
        if (process.env.RENDER_EXTERNAL_URL) console.log(`URL del Backend configurada: ${process.env.RENDER_EXTERNAL_URL}`);
    });
}).catch(err => {
    // El error ya fue logueado en initializeDatabase, el proceso se detendrá.
});
