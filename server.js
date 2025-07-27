// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
// Importar los componentes necesarios de la nueva versión del SDK de Mercado Pago
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
// Render proporciona el puerto a través de una variable de entorno. Usamos 4000 como fallback para local.
const port = process.env.PORT || 4000;

// --- Middlewares ---

// Configuración de CORS más específica y segura para evitar errores "Failed to fetch"
// Solo permite solicitudes desde la URL del frontend configurada en las variables de entorno.
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://127.0.0.1:5500', // Permite la URL de producción y un fallback para local
  optionsSuccessStatus: 200 // Para compatibilidad con navegadores antiguos
};
app.use(cors(corsOptions));

// Permite al servidor entender JSON que se envía en las solicitudes
app.use(express.json());


// --- Configuración de Mercado Pago ---
// Es CRUCIAL que el Access Token esté en una variable de entorno y no directamente en el código.
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!mpAccessToken) {
    console.error("Error: La variable de entorno MERCADOPAGO_ACCESS_TOKEN no está definida.");
}

// Inicializar el cliente de Mercado Pago con el Access Token (Sintaxis v2)
const client = new MercadoPagoConfig({ accessToken: mpAccessToken });


// --- Base de Datos en Memoria (Simulación) ---
// En una aplicación real, esto sería una base de datos como PostgreSQL, MongoDB, etc.
// Los datos aquí se perderán si el servidor se reinicia.
const users = [];


// --- Endpoints de la API ---

// 1. Registro de Usuario
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Todos los campos son requeridos.' });
    }

    const userExists = users.find(user => user.email === email);
    if (userExists) {
        return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
    }

    const newUser = { 
        id: users.length + 1, 
        name, 
        email, 
        password, // En una app real, la contraseña se hashearía
        paid: false // Nuevo campo para rastrear el estado del pago
    }; 
    users.push(newUser);

    console.log(`Usuario registrado: ${newUser.email}`); // Log para visibilidad en Render
    res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email, isPaid: newUser.paid });
});

// 2. Inicio de Sesión de Usuario
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
    }

    const user = users.find(user => user.email === email);
    if (!user || user.password !== password) { // En una app real, se compararía el hash de la contraseña
        return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    console.log('Usuario inició sesión:', user.email);
    res.status(200).json({ id: user.id, name: user.name, email: user.email, isPaid: user.paid });
});

// 3. Creación de Preferencia de Pago en Mercado Pago
app.post('/api/create-payment-preference', async (req, res) => {
    const { userId, userEmail } = req.body; // Recibimos el ID del usuario
    if (!userId) {
        return res.status(400).json({ message: 'Se requiere el ID del usuario para crear el pago.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';

    const preferenceBody = {
        items: [
            {
                title: 'Acceso a 10 Ideas de Negocio Exclusivas',
                description: 'Contenido digital con guías en PDF para emprender.',
                quantity: 1,
                unit_price: 1300,
                currency_id: 'ARS',
            },
        ],
        payer: {
            email: userEmail,
        },
        back_urls: {
            success: `${frontendUrl}/index.html`, // La data extra la añade MP automáticamente
            failure: `${frontendUrl}/index.html`,
            pending: `${frontendUrl}/index.html`,
        },
        auto_return: 'approved',
        external_reference: userId.toString(), // Asociamos el pago al ID del usuario
    };

    try {
        const preference = new Preference(client);
        const result = await preference.create({ body: preferenceBody });
        
        console.log(`Preferencia de pago creada para el usuario ${userId}: ${result.id}`);
        res.status(201).json({
            id: result.id,
            init_point: result.init_point, // La URL de pago que usará el frontend
        });
    } catch (error) {
        console.error('Error al crear la preferencia de pago:', error);
        res.status(500).json({ message: 'Error del servidor al contactar Mercado Pago.' });
    }
});

// 4. Endpoint para confirmar el pago y marcar al usuario
app.post('/api/confirm-payment', (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ message: 'User ID es requerido.' });
    }

    const user = users.find(u => u.id.toString() === userId.toString());
    if (user) {
        user.paid = true;
        console.log(`Pago confirmado para el usuario: ${user.email}`); // Log para visibilidad en Render
        res.status(200).json({ message: 'Pago confirmado exitosamente.' });
    } else {
        console.error(`Intento de confirmación de pago para usuario no encontrado: ${userId}`);
        res.status(404).json({ message: 'Usuario no encontrado.' });
    }
});


// --- Iniciar el Servidor ---
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});

// --- Iniciar el Servidor ---
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});
