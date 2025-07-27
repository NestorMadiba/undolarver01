// Cargar variables de entorno desde el archivo .env para desarrollo local
require('dotenv').config();

const express = require('express');
const cors = require('cors');
// *** CORRECCIÓN CRÍTICA: Importar 'Payment' junto con los otros módulos. ***
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 4000;

// --- Verificación de Variables de Entorno Críticas ---
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const frontendUrl = process.env.FRONTEND_URL;
const databaseUrl = process.env.DATABASE_URL;
// *** NUEVO: La URL del backend ahora es obligatoria para los webhooks. ***
const backendUrl = process.env.BACKEND_URL; 

if (!mpAccessToken || !frontendUrl || !databaseUrl || !backendUrl) {
    console.error("FATAL ERROR: Faltan variables de entorno críticas (MERCADOPAGO_ACCESS_TOKEN, FRONTEND_URL, DATABASE_URL, BACKEND_URL).");
    console.error("Por favor, configúrelas en la pestaña 'Environment' de su servicio en Render.");
    process.exit(1);
}

// --- Configuración de la Base de Datos PostgreSQL ---
const pool = new Pool({
  connectionString: databaseUrl,
});

const initializeDatabase = async () => {
    try {
        const client = await pool.connect();
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
// Aumentar el límite de payload para los webhooks de Mercado Pago
app.use(express.json({ limit: '5mb' }));


// --- Configuración de Mercado Pago ---
const mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });


// *** CORRECCIÓN: Endpoint de "Salud" para Render para evitar el SIGTERM. ***
app.get('/', (req, res) => {
    res.send('El servidor de Ideas 1 Dólar está vivo y funcionando!');
});


// --- Endpoints de la API ---

// Mover las rutas de la API bajo un prefijo /api
const apiRouter = express.Router();

// 1. Registro de Usuario
apiRouter.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Todos los campos son requeridos.' });
    }
    const query = 'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, paid';
    try {
        const result = await pool.query(query, [name, email, password]);
        const newUser = result.rows[0];
        console.log(`Usuario registrado en DB: ${newUser.email}`);
        res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email, isPaid: newUser.paid });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
        }
        console.error("Error en registro de usuario:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 2. Inicio de Sesión de Usuario
apiRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }
    const query = 'SELECT * FROM users WHERE email = $1';
    try {
        const result = await pool.query(query, [email]);
        const user = result.rows[0];
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
apiRouter.post('/create-payment-preference', async (req, res) => {
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
        // *** MEJORA: Se pasa el external_reference en las URLs de retorno. ***
        back_urls: {
            success: `${frontendUrl}?status=approved&external_reference=${userId}`,
            failure: `${frontendUrl}?status=failure&external_reference=${userId}`,
            pending: `${frontendUrl}?status=pending&external_reference=${userId}`,
        },
        auto_return: 'approved',
        external_reference: userId.toString(),
        // *** CORRECCIÓN: Se usa la variable de entorno `backendUrl` para mayor fiabilidad. ***
        notification_url: `${backendUrl}/api/payment-webhook`
    };
    try {
        const preference = new Preference(mpClient);
        const result = await preference.create({ body: preferenceBody });
        console.log(`Preferencia de pago creada para usuario ID ${userId}: ${result.id}`);
        res.status(201).json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error al crear la preferencia de pago:', error.cause || error);
        res.status(500).json({ message: 'Error al contactar Mercado Pago.' });
    }
});

// 4. Webhook de MercadoPago
apiRouter.post('/payment-webhook', async (req, res) => {
    const { type, data } = req.body;
    console.log('Webhook de Mercado Pago recibido:', req.body);

    if (type === 'payment' && data && data.id) {
        try {
            // *** CORRECCIÓN CRÍTICA: Se usa el objeto 'Payment' correctamente. ***
            const payment = await new Payment(mpClient).get({ id: data.id });
            const userId = payment.external_reference;
            
            if (payment.status === 'approved' && userId) {
                 const query = 'UPDATE users SET paid = TRUE WHERE id = $1 RETURNING email';
                 const result = await pool.query(query, [parseInt(userId, 10)]);
                 if (result.rowCount > 0) {
                    console.log(`WEBHOOK: Pago confirmado en DB para el usuario: ${result.rows[0].email} (ID: ${userId})`);
                 }
            }
        } catch (error) {
            console.error('Error procesando webhook de MP:', error.cause || error);
            // Devolver 500 para que MP reintente si hay un error nuestro.
            return res.status(500).send('Error processing webhook');
        }
    }
    // Devolver 200 siempre que se reciba la notificación para que MP no siga reintentando.
    res.sendStatus(200);
});

// 5. Confirmación de Pago (desde el frontend, como respaldo)
apiRouter.post('/confirm-payment', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'User ID es requerido.' });
    
    const query = 'UPDATE users SET paid = TRUE WHERE id = $1 RETURNING email';
    try {
        const result = await pool.query(query, [parseInt(userId, 10)]);
        if (result.rowCount > 0) {
            console.log(`Pago confirmado en DB (vía frontend) para el usuario: ${result.rows[0].email}`);
            res.status(200).json({ message: 'Pago confirmado exitosamente.' });
        } else {
            res.status(404).json({ message: 'Usuario no encontrado.' });
        }
    } catch (error) {
        console.error("Error al confirmar pago en DB:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// 6. Endpoint de Administración para Marcar Pago Manualmente
apiRouter.post('/mark-as-paid', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'El email del usuario es requerido.' });

    const query = 'UPDATE users SET paid = TRUE WHERE email = $1 RETURNING email';
    try {
        const result = await pool.query(query, [email]);
        if (result.rowCount > 0) {
            console.log(`ADMIN: Pago marcado manualmente para el usuario: ${result.rows[0].email}`);
            res.status(200).json({ message: `Usuario ${email} marcado como pagado.` });
        } else {
            res.status(404).json({ message: `Usuario con email ${email} no encontrado.` });
        }
    } catch (error) {
        console.error("Error en la marcación manual de pago:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});


// Usar el router para todas las rutas /api
app.use('/api', apiRouter);

// --- Iniciar el Servidor ---
const startServer = async () => {
    await initializeDatabase();
    app.listen(port, () => {
        console.log(`Servidor escuchando en el puerto ${port}`);
        console.log(`URL del Frontend configurada: ${frontendUrl}`);
        console.log(`URL del Backend configurada: ${backendUrl}`);
    });
};

startServer();
