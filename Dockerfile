# --- Etapa 1: Builder ---
# Usamos una imagen completa de Node para instalar dependencias
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .

# --- Etapa 2: Runner ---
# Usamos una imagen más pequeña y segura para la ejecución final
FROM node:18-alpine
WORKDIR /app

# Copiar las dependencias y el código desde la etapa anterior
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./

# Exponer el puerto que nuestra app usará (el que Northflank necesita saber)
EXPOSE 4000

# El comando para iniciar la aplicación
CMD ["npm", "start"]