# 1. Usar una imagen base de Node.js oficial y ligera
FROM node:18-alpine

# 2. Establecer el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# 3. Copiar los archivos de dependencias para aprovechar el cache de Docker
# Copia package.json y package-lock.json (si existe)
COPY package*.json ./

# 4. Instalar las dependencias del proyecto
RUN npm install

# 5. Copiar el resto de los archivos de la aplicación al directorio de trabajo
COPY . .

# 6. Exponer el puerto en el que la aplicación se ejecuta
# Tu server.js usa process.env.PORT o 4000, así que exponemos el 4000
EXPOSE 4000

# 7. El comando para iniciar la aplicación cuando el contenedor se inicie
CMD [ "npm", "start" ]
