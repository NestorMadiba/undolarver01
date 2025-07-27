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
// Permite que nuestro frontend (en otro dominio/puerto) se comunique con este backend
app.use(cors());
// Permite al servidor entender JSON que se envía en las solicitudes
app.use(express.json());


// --- Configuración de Mercado Pago ---
// Es CRUCIAL que el Access Token esté en una variable de entorno y no directamente en el código.
const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!mpAccessToken) {
    console.error("Error: La variable de entorno MERCADOPAGO_ACCESS_TOKEN no está definida.");
    // En un escenario real, podríamos querer detener el servidor si la clave no está presente.
}

// Inicializar el cliente de Mercado Pago con el Access Token (Sintaxis v2)
const client = new MercadoPagoConfig({ accessToken: mpAccessToken });


// --- Base de Datos en Memoria (Simulación) ---
// En una aplicación real, esto sería una base de datos como PostgreSQL, MongoDB, etc.
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

    const newUser = { id: users.length + 1, name, email, password }; // En una app real, la contraseña se hashearía
    users.push(newUser);

    console.log('Usuario registrado:', newUser);
    res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email });
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
    res.status(200).json({ id: user.id, name: user.name, email: user.email });
});


// 3. Creación de Preferencia de Pago en Mercado Pago (Actualizado a v2 del SDK)
app.post('/api/create-payment-preference', async (req, res) => {
    // La URL del frontend se obtiene de una variable de entorno para flexibilidad.
    // Si no está definida, se usa un valor por defecto para desarrollo local.
    const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5500'; // Ajusta el puerto si usas otro para Live Server

    const preferenceBody = {
        items: [
            {
                title: 'Acceso a 10 Ideas de Negocio Exclusivas',
                description: 'Contenido digital con guías en PDF para emprender.',
                quantity: 1,
                unit_price: 1300, // Precio en ARS
                currency_id: 'ARS',
            },
        ],
        back_urls: {
            // URLs a las que Mercado Pago redirigirá al usuario después del pago
            success: `${frontendUrl}/index.html?status=approved`, 
            failure: `${frontendUrl}/index.html?status=failure`,
            pending: `${frontendUrl}/index.html?status=pending`,
        },
        auto_return: 'approved', // Redirige automáticamente solo si el pago fue aprobado
    };

    try {
        const preference = new Preference(client);
        const result = await preference.create({ body: preferenceBody });
        
        console.log('Preferencia de pago creada:', result.id);
        res.status(201).json({
            id: result.id,
            init_point: result.init_point, // La URL de pago que usará el frontend
        });
    } catch (error) {
        console.error('Error al crear la preferencia de pago:', error);
        res.status(500).json({ message: 'Error del servidor al contactar Mercado Pago.' });
    }
});


// --- Iniciar el Servidor ---
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});
