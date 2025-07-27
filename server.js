// Cargar variables de entorno desde el archivo .env para desarrollo local
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const { Pool } = require('pg'); // Importar el cliente de PostgreSQL

const app = express();
const port = process.env.PORT || 4000;

// --- Verificación de Variables de Entorno Críticas ---
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const frontendUrl = process.env.FRONTEND_URL;
const databaseUrl = process.env.DATABASE_URL; // Nueva variable para la base de datos

if (!mpAccessToken || !frontendUrl || !databaseUrl) {
    console.error("FATAL ERROR: Una o más variables de entorno críticas no están definidas (MERCADOPAGO_ACCESS_TOKEN, FRONTEND_URL, DATABASE_URL).");
    console.error("Por favor, configúrelas en la pestaña 'Environment' de su servicio en Render.");
    process.exit(1);
}

// --- Configuración de la Base de Datos PostgreSQL ---
const pool = new Pool({
  connectionString: databaseUrl,
  // Render requiere SSL para conexiones externas, pero no para internas.
  // Esta configuración es segura para el entorno de Render.
  ssl: {
    rejectUnauthorized: false
  }
});

// Función para inicializar la base de datos
const initializeDatabase = async () => {
    try {
        const client = await pool.connect();
        // Crear la tabla de usuarios si no existe
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                paid BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        client.release();
        console.log("Base de datos conectada y tabla 'users' asegurada.");
    } catch (error) {
        console.error("FATAL ERROR: No se pudo conectar o inicializar la base de datos.", error);
        process.exit(1);
    }
};


// --- Middlewares ---
const corsOptions = {
  origin: frontendUrl,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// --- Configuración de Mercado Pago ---
const mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });

// --- Endpoints de la API (Ahora con Base de Datos) ---

// 1. Registro de Usuario
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Todos los campos son requeridos.' });
    }
    // NOTA: En producción real, la contraseña debe ser "hasheada" antes de guardarla.
    const query = 'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, paid';
    try {
        const result = await pool.query(query, [name, email, password]);
        const newUser = result.rows[0];
        console.log(`Usuario registrado en DB: ${newUser.email}`);
        res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email, isPaid: newUser.paid });
    } catch (error) {
        if (error.code === '23505') { // Código de error para violación de constraint 'unique'
            return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
        }
        console.error("Error en registro de usuario:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 2. Inicio de Sesión de Usuario
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }
    const query = 'SELECT * FROM users WHERE email = $1';
    try {
        const result = await pool.query(query, [email]);
        const user = result.rows[0];
        // NOTA: En producción, comparar contraseñas hasheadas.
        if (!user || user.password !== password) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }
        console.log(`Usuario inició sesión: ${user.email}, Estado de pago: ${user.paid}`);
        res.status(200).json({ id: user.id, name: user.name, email: user.email, isPaid: user.paid });
    } catch (error) {
        console.error("Error en inicio de sesión:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 3. Creación de Preferencia de Pago
app.post('/api/create-payment-preference', async (req, res) => {
    const { userId, userEmail } = req.body;
    if (!userId) return res.status(400).json({ message: 'Se requiere el ID del usuario.' });

    const preferenceBody = {
        items: [{
            title: 'Acceso a 10 Ideas de Negocio Exclusivas',
            description: 'Contenido digital con guías en PDF para emprender.',
            quantity: 1,
            unit_price: 1300,
            currency_id: 'ARS',
        }],
        payer: { email: userEmail },
        back_urls: {
            success: frontendUrl,
            failure: frontendUrl,
            pending: frontendUrl,
        },
        auto_return: 'approved',
        external_reference: userId.toString(),
    };
    try {
        const preference = new Preference(mpClient);
        const result = await preference.create({ body: preferenceBody });
        console.log(`Preferencia de pago creada para usuario ID ${userId}: ${result.id}`);
        res.status(201).json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error al crear la preferencia de pago:', error);
        res.status(500).json({ message: 'Error al contactar Mercado Pago.' });
    }
});

// 4. Confirmación de Pago (desde el frontend, después de la redirección de MP)
app.post('/api/confirm-payment', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'User ID es requerido.' });
    
    const query = 'UPDATE users SET paid = TRUE WHERE id = $1 RETURNING email';
    try {
        const result = await pool.query(query, [userId]);
        if (result.rowCount > 0) {
            console.log(`Pago confirmado en DB para el usuario: ${result.rows[0].email}`);
            res.status(200).json({ message: 'Pago confirmado exitosamente.' });
        } else {
            console.error(`Intento de confirmación para usuario no encontrado en DB: ${userId}`);
            res.status(404).json({ message: 'Usuario no encontrado.' });
        }
    } catch (error) {
        console.error("Error al confirmar pago en DB:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 5. Endpoint de Administración para Marcar Pago Manualmente
app.post('/api/mark-as-paid', async (req, res) => {
    const { email } = req.body;
    // En un futuro, este endpoint debería estar protegido por una clave de API o autenticación de admin.
    if (!email) return res.status(400).json({ message: 'El email del usuario es requerido.' });

    const query = 'UPDATE users SET paid = TRUE WHERE email = $1 RETURNING email';
    try {
        const result = await pool.query(query, [email]);
        if (result.rowCount > 0) {
            console.log(`ADMIN: Pago marcado manualmente para el usuario: ${result.rows[0].email}`);
            res.status(200).json({ message: `Usuario ${email} marcado como pagado.` });
        } else {
            console.warn(`ADMIN: Intento de marcar pago para email no encontrado: ${email}`);
            res.status(404).json({ message: `Usuario con email ${email} no encontrado.` });
        }
    } catch (error) {
        console.error("Error en la marcación manual de pago:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});


// --- Iniciar el Servidor ---
const startServer = async () => {
    await initializeDatabase();
    app.listen(port, () => {
        console.log(`Servidor escuchando en el puerto ${port}`);
    });
};

startServer();
