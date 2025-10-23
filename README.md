# IT-Tots-helpbot
Este proyecto es un chatbot desarrollado en Node.js, containerizado usando Docker para facilitar su despliegue y ejecución en cualquier entorno.
Su principal objetivo es realizar un flujo conversacional para levantar tareas en ClickUp.
# Requisitos
- Node.js >= 18
- Docker
- Docker Compose

# Instalación
1. Clonar el repositorio
2. Crear archivo .env para configurar variables de entorno:
DISCORD_TOKEN=discord_token
CLICKUP_TOKEN=tu_clickup_token

3. Construir la imagen de Docker:
`docker compose up --build`

4. Unirlo al servidor y usar el commando `--help`
