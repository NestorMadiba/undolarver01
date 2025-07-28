// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

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
        process.exit(1); // Detiene el servidor si la DB no puede iniciarse
    }
}

// --- Configuración de Mercado Pago ---
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!mpAccessToken) {
    console.error("Error: La variable de entorno MERCADOPAGO_ACCESS_TOKEN no está definida.");
} else {
    mercadopago.configure({
        access_token: mpAccessToken,
    });
}

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

    const frontendUrl = process.env.FRONTEND_URL || `http://127.0.0.1:5500`;
    const backendUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

    const preference = {
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
        const response = await mercadopago.preferences.create(preference);
        console.log('Preferencia de pago creada:', response.body.id);
        res.status(201).json({
            id: response.body.id,
            init_point: response.body.init_point,
        });
    } catch (error) {
        console.error('Error al crear la preferencia de pago:', error.cause || error);
        res.status(500).json({ message: 'Error del servidor al contactar Mercado Pago.' });
    }
});

// 4. Webhook para notificaciones de Mercado Pago
app.post('/api/mp-webhook', async (req, res) => {
    const { type, data } = req.body;

    if (type === 'payment') {
        try {
            const payment = await mercadopago.payment.findById(data.id);
            const paymentStatus = payment.body.status;
            const externalReference = payment.body.external_reference;

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
// Solo inicia el servidor después de que la base de datos esté lista.
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Servidor escuchando en el puerto ${port}`);
        if (process.env.FRONTEND_URL) console.log(`URL del Frontend configurada: ${process.env.FRONTEND_URL}`);
        if (process.env.RENDER_EXTERNAL_URL) console.log(`URL del Backend configurada: ${process.env.RENDER_EXTERNAL_URL}`);
    });
}).catch(err => {
    // El error ya se logueó en initializeDatabase
    // El proceso se detendrá, así que no es necesario hacer más aquí.
});
