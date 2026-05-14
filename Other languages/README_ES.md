# 🏠 Homelab

Un servidor doméstico ligero y autoalojado construido con **Node.js + Express**, diseñado para ejecutarse en una Raspberry Pi o cualquier máquina Linux. Proporciona tres servicios a través de una única interfaz web:

- **🎬 HomeVideo** — streaming de vídeo local (películas, series de TV, vídeos varios) con una biblioteca estilo Netflix, soporte para pósters personalizados y extracción de subtítulos de archivos MKV
- **☁️ HomeCloud** — almacenamiento en la nube personal con subida/descarga, gestión de carpetas, vista previa inline de archivos y arrastrar y soltar
- **🤖 HomeAI** — chat de IA local basado en [Ollama](https://ollama.com), con un selector dinámico de modelos

Todos los servicios son accesibles desde cualquier dispositivo en tu red local (y de forma remota a través de Tailscale). Sin suscripciones en la nube, sin telemetría, sin anuncios.

> **Este proyecto funciona en una Raspberry Pi 3B** — es el hardware en el que fue desarrollado y probado. HomeVideo y HomeCloud funcionan perfectamente. La Chat de IA también funciona, pero está limitada a modelos muy pequeños debido al límite de 1 GB de RAM.

---

## Requisitos de Hardware

| Hardware | Requisito |
|---|---|
| **Single-board computer / PC** | Raspberry Pi 3B *(mínimo)*, **Raspberry Pi 4 recomendada** |
| **Tarjeta microSD** | 16 GB+, Clase 10 o UHS-I |
| **Fuente de alimentación** | 5V/2.5A microUSB (Pi 3B) o 5V/3A USB-C (Pi 4) — **no** un cargador de teléfono |
| **Cable Ethernet** | Conexión por cable muy recomendada |
| **HDD externo** | 2.5" SATA + adaptador USB, cualquier tamaño |
| **PC/Mac** | Para flashear la tarjeta SD y transferir archivos |

> **Raspberry Pi 3B vs 4:** La Pi 3B ejecuta HomeVideo y HomeCloud sin problemas. Sin embargo, la sección de Chat de IA requiere Ollama, que con 1 GB de RAM solo puede ejecutar modelos muy pequeños (p. ej. `gemma3:1b`) — las respuestas serán lentas. Se recomienda encarecidamente una **Pi 4 (4 GB+)** o un mini-PC si la chat de IA es importante para ti. Una Pi 5, un portátil antiguo o cualquier máquina x86 ofrecerá un rendimiento de IA mucho mejor.

---

## Estructura del Proyecto

```
homelab/
├── server.js          ← Servidor Express (API + servicio de archivos estáticos)
├── package.json
├── .sessions.json     ← generado automáticamente, almacena los tokens de sesión activos
└── public/
    ├── index.html     ← Página principal (enlaces a las tres secciones)
    ├── video.html     ← Interfaz de streaming de vídeo
    ├── cloud.html     ← Interfaz de almacenamiento en la nube
    └── chat.html      ← Interfaz de chat de IA
```

**Distribución del HDD** (montado en `/mnt/hdd`):
```
/mnt/hdd/
├── video/
│   ├── Film/
│   │   └── Título Película/
│   │       ├── pelicula.mp4
│   │       └── cover.jpg     ← póster opcional (proporción 2:3 recomendada)
│   ├── Serie/
│   │   └── Nombre Serie/
│   │       ├── S01E01 - Título Episodio.mp4
│   │       ├── S01E02 - Título Episodio.mp4
│   │       └── cover.jpg
│   └── Video/
│       └── cualquiera.mp4      ← vídeos sueltos, sin subcarpeta necesaria
└── cloud/                    ← raíz del almacenamiento de HomeCloud
```

---

## Guía de Instalación

### 1. Flashear el sistema operativo

1. Descarga e instala [Raspberry Pi Imager](https://www.raspberrypi.com/software/) en tu PC.
2. Inserta la tarjeta microSD.
3. En Raspberry Pi Imager, selecciona:
   - **Device:** Raspberry Pi 3 (o 4)
   - **OS:** Raspberry Pi OS Lite (64-bit) — sin escritorio, más ligero
   - **Storage:** tu microSD
4. Abre los **Ajustes avanzados** (⚙) antes de escribir y configura:
   - **Hostname:** `homelab`
   - **Habilitar SSH** → autenticación por contraseña
   - **Username:** `pi` — elige una contraseña segura
   - **Locale:** tu región y distribución de teclado
   - ⚠️ **NO configures el Wi-Fi** — usa solo ethernet para mayor fiabilidad
5. Haz clic en **Write** y espera (3–5 minutos).

---

### 2. Primer arranque y conexión SSH

1. Inserta la microSD en la Pi, conecta el cable ethernet y luego enchúfala a la corriente.
2. Espera ~90 segundos hasta que el LED verde se ralentice.
3. Encuentra la IP de la Pi: abre el panel de administración de tu router (normalmente `192.168.1.1`) y busca un dispositivo llamado `homelab`.
4. Conéctate por SSH desde el terminal de tu PC:
   ```bash
   ssh pi@192.168.1.105   # reemplaza con la IP de tu Pi
   ```
   Escribe `yes` en el aviso de clave del host, luego introduce tu contraseña.
5. Actualiza el sistema:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

---

### 3. Configurar una IP estática

Una IP estática garantiza que el servidor siempre sea accesible en la misma dirección.

**Recomendado — Reserva DHCP en el router:**
1. Encuentra la dirección MAC de la Pi:
   ```bash
   ip link show eth0
   # busca la línea: link/ether xx:xx:xx:xx:xx:xx
   ```
2. En la configuración DHCP de tu router, asocia esa dirección MAC a una IP fija (p. ej. `192.168.1.100`) y guarda.
3. Reinicia la Pi:
   ```bash
   sudo reboot
   ```
4. Vuelve a conectarte: `ssh pi@192.168.1.100`

**Alternativa — IP estática en la propia Pi:**
```bash
sudo nano /etc/dhcpcd.conf
```
Añade al final (ajusta las IPs a tu router):
```
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8
```
Guarda con `CTRL+X → Y → Enter`, luego reinicia.

---

### 4. Instalar Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node --version && npm --version
```

Deberías ver algo como `v20.x.x` y `10.x.x`.

---

### 5. Conectar y montar el HDD

```bash
# Comprueba que la Pi detecta el disco
lsblk
# Deberías ver sda / sda1
```

**Si el HDD es NTFS (proviene de Windows):**
```bash
sudo apt install -y ntfs-3g
```

**Si quieres formatear el HDD a ext4 (recomendado para Linux — más rápido y estable):**
```bash
sudo mkfs.ext4 /dev/sda1
# ⚠ Esto borra todos los datos del disco
```

**Monta y crea la estructura de carpetas:**
```bash
sudo mkdir /mnt/hdd
sudo mount /dev/sda1 /mnt/hdd

sudo mkdir -p /mnt/hdd/video/Film
sudo mkdir -p /mnt/hdd/video/Serie
sudo mkdir -p /mnt/hdd/video/Video
sudo mkdir -p /mnt/hdd/cloud
sudo chown -R pi:pi /mnt/hdd
```

**Configura el montaje automático al arrancar:**
```bash
# Encuentra el UUID del disco
sudo blkid /dev/sda1
# Copia el valor UUID, p. ej. a1b2c3d4-e5f6-7890-abcd-ef1234567890

sudo nano /etc/fstab
```
Añade esta línea al final (reemplaza `YOUR-UUID`):
```
UUID=YOUR-UUID /mnt/hdd auto defaults,nofail 0 0
```
Pruébalo:
```bash
sudo mount -a
# Sin salida = correcto
```

---

### 6. Configurar zRAM (Recomendado para Pi 3B)

zRAM crea un espacio de swap comprimido en RAM, lo que ayuda significativamente cuando la memoria está bajo presión — especialmente en el Pi 3B con 1 GB.

```bash
sudo apt install -y zram-tools
```

Edita la configuración:
```bash
sudo nano /etc/default/zramswap
```
Establece (o confirma):
```
ALGO=lz4
PERCENT=50
```
Habilita e inicia:
```bash
sudo systemctl enable zramswap
sudo systemctl start zramswap
```
Verifica que esté activo:
```bash
swapon --show
# Debería mostrar una entrada /dev/zram0
```

Opcionalmente también puedes añadir un archivo de swap en el HDD como desbordamiento adicional (más lento, pero útil):
```bash
sudo fallocate -l 2G /mnt/hdd/swapfile
sudo chmod 600 /mnt/hdd/swapfile
sudo mkswap /mnt/hdd/swapfile
sudo swapon /mnt/hdd/swapfile
```
Añade a `/etc/fstab` para que persista tras los reinicios:
```
/mnt/hdd/swapfile none swap sw 0 0
```

---

### 7. Transferir los archivos del proyecto

Primero, crea la estructura de carpetas del proyecto en la Pi:
```bash
mkdir ~/homelab
mkdir ~/homelab/public
```

Luego, en tu PC, abre un terminal en la carpeta donde descargaste los archivos del proyecto:
```bash
# Transfiere server.js y package.json
scp server.js pi@192.168.1.100:~/homelab/server.js
scp package.json pi@192.168.1.100:~/homelab/package.json

# Transfiere todas las páginas HTML
scp public/index.html public/video.html public/cloud.html public/chat.html \
    pi@192.168.1.100:~/homelab/public/
```

En la Pi, verifica que los archivos hayan llegado:
```bash
ls ~/homelab/
ls ~/homelab/public/
```

---

### 8. Configurar el servidor

#### Establecer contraseñas

```bash
nano ~/homelab/server.js
```

Encuentra estas líneas al comienzo del archivo y edítalas:
```js
const CLOUD_PASSWORD = 'your-cloud-password';  // contraseña para HomeCloud
const VIDEO_PIN      = '1234';                 // PIN numérico para HomeVideo
```
Guarda con `CTRL+X → Y → Enter`.

---

### 9. Instalar dependencias y probar

```bash
cd ~/homelab && npm install
node server.js
```

Abre un navegador en cualquier dispositivo de tu red y ve a:
```
http://192.168.1.100:3000
```

Si ves la página principal de Homelab, todo funciona. Pulsa `CTRL+C` para detener el servidor.

---

### 10. Arranque automático con PM2

PM2 es un gestor de procesos que mantiene el servidor en funcionamiento 24/7 y lo reinicia automáticamente tras cada reinicio del sistema.

```bash
# Instala PM2 globalmente
sudo npm install -g pm2

# Inicia el servidor
cd ~/homelab && pm2 start server.js --name homelab

# Comprueba que esté en ejecución
pm2 status

# Configura PM2 para iniciarse al arrancar
pm2 startup
# Copia y ejecuta el comando que imprime (será algo como):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pi --hp /home/pi

# Guarda la lista de procesos actual
pm2 save
```

Reinicia para confirmar que todo arranca automáticamente:
```bash
sudo reboot
# Espera 60 segundos, luego:
ssh pi@192.168.1.100
pm2 status
# homelab debería aparecer como "online"
```

**Comandos útiles de PM2:**
```bash
pm2 logs homelab       # logs en tiempo real (CTRL+C para salir)
pm2 restart homelab    # reinicia tras editar archivos
pm2 stop homelab       # detiene el servidor
pm2 status             # estado de todos los procesos
```

---

### 11. Acceso remoto con Tailscale (Opcional)

[Tailscale](https://tailscale.com) crea una VPN privada entre tus dispositivos, permitiéndote acceder al homelab desde cualquier lugar sin necesidad de reenvío de puertos ni exponer nada a internet.

**En la Pi:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Sigue el enlace de autenticación que aparece en el terminal, luego anota la IP de Tailscale asignada a la Pi (visible en [tailscale.com/admin](https://login.tailscale.com/admin/machines) o mediante `tailscale ip`).

**En cada dispositivo cliente** (teléfono, portátil, etc.): instala la app de Tailscale e inicia sesión con la misma cuenta.

Una vez conectado, puedes acceder al homelab desde cualquier lugar usando:
```
http://<tailscale-ip>:3000
```

> **Nota:** Tailscale es gratuito para uso personal (hasta 3 usuarios, 100 dispositivos).

---

### 12. Instalar Ollama y un modelo (Chat de IA)

> ⚠️ La Pi 3B solo tiene 1 GB de RAM. Solo funcionarán los modelos más pequeños (`gemma3:1b`, ~800 MB) y las respuestas serán lentas. Se recomienda encarecidamente una **Pi 4 con 4 GB+ de RAM** o una máquina más potente para una buena experiencia de chat de IA.

```bash
# Instala Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Descarga el modelo más ligero (funciona en Pi 3B)
ollama pull gemma3:1b

# Pruébalo
ollama run gemma3:1b
# Escribe un mensaje, pulsa Enter. Escribe /bye para salir.
```

Verifica que Ollama esté en ejecución y sea accesible:
```bash
curl http://localhost:11434/api/tags
# Debería devolver una lista JSON de los modelos instalados
```

Eso es todo. La página de Chat de IA se comunica con Ollama a través del proxy del servidor Node.js (`/api/chat/tags` y `/api/chat/send`), que se conecta a `localhost:11434` en la Pi. Esto significa:
- No se necesita configuración de IP en ningún archivo
- Ollama solo escucha en localhost — nunca se expone en la red
- Todo funciona de forma transparente tanto en tu red local como de forma remota a través de Tailscale

Cualquier modelo adicional que descargues con `ollama pull` aparecerá automáticamente en el selector de modelos.

**Sugerencias de modelos por hardware:**
| Hardware | Modelo recomendado |
|---|---|
| Pi 3B (1 GB RAM) | `gemma3:1b` |
| Pi 4 (4 GB RAM) | `gemma3:4b`, `llama3.2:3b` |
| Pi 4/5 (8 GB RAM) o mini-PC | `llama3.1:8b`, `mistral:7b` |

---

## Añadir contenido a HomeVideo

### Películas

Cada película debe estar en su propia subcarpeta dentro de `Film/`:

```bash
# Crea la carpeta
mkdir -p /mnt/hdd/video/Film/Inception

# Copia el vídeo (desde el PC por SCP)
scp /path/to/inception.mp4 pi@192.168.1.100:/mnt/hdd/video/Film/Inception/

# Opcional: añade un póster (el nombre debe ser cover.jpg, proporción 2:3)
scp cover.jpg pi@192.168.1.100:/mnt/hdd/video/Film/Inception/
```

### Series de TV

Los episodios deben seguir el formato de nombre `S01E01` para que el servidor pueda agruparlos por temporada:

```bash
mkdir -p /mnt/hdd/video/Serie/Breaking\ Bad
scp S01E01\ -\ Pilot.mp4 S01E02\ -\ ....mp4 \
    pi@192.168.1.100:/mnt/hdd/video/Serie/Breaking\ Bad/
```

### Formatos de vídeo compatibles

| Formato | Compatibilidad |
|---|---|
| **MP4 (H.264)** | ✅ Todos los navegadores — recomendado |
| MKV | ⚠️ La mayoría de navegadores de escritorio; puede fallar en Safari/iOS |
| AVI, MOV | ⚠️ Soporte limitado en navegadores |
| WebM | ✅ Buen soporte en navegadores |

> Para máxima compatibilidad, convierte otros formatos a MP4 H.264 usando **HandBrake** (gratuito).

### Subtítulos MKV

Si `ffmpeg` está instalado en la Pi, el reproductor de vídeo ofrecerá automáticamente las pistas de subtítulos incrustadas en los archivos MKV a través del botón **CC**. Instálalo con:
```bash
sudo apt install -y ffmpeg
```

---

## Reemplazar o actualizar el HDD

Cuando quieras un disco más grande:

1. Copia todos los archivos del HDD antiguo al nuevo desde tu PC.
2. Conecta el nuevo HDD a la Pi.
3. Encuentra el nuevo UUID: `sudo blkid /dev/sda1`
4. Actualiza `/etc/fstab` con el nuevo UUID (reemplaza la línea anterior).
5. Prueba: `sudo mount -a`
6. Reinicia: `sudo reboot`

El servidor siempre lee desde `/mnt/hdd/` — no se necesita ningún otro cambio.

---

## Solución de Problemas

### SSH no se conecta
- Comprueba que la Pi esté encendida y el LED verde parpadee
- Encuentra su IP en la lista de dispositivos del router
- Prueba con: `ping 192.168.1.100`
- Si cambiaste la IP: `ssh-keygen -R ip_antigua`

### El navegador no carga la página
- Comprueba que PM2 esté en ejecución: `pm2 status`
- Comprueba los logs: `pm2 logs homelab`
- Asegúrate de incluir el puerto: `http://192.168.1.100:3000`
- Tu dispositivo debe estar en la misma red (o conectado a través de Tailscale)

### Los vídeos no aparecen en la biblioteca
- Verifica que el HDD esté montado: `df -h | grep hdd`
- Comprueba la estructura de carpetas: `ls /mnt/hdd/video/Film/`
- Cada película **debe** estar en su propia subcarpeta dentro de `Film/`
- Reinicia el servidor tras añadir archivos: `pm2 restart homelab`

### El vídeo no se reproduce
- MP4 con codec H.264 tiene la compatibilidad más amplia — convierte con HandBrake
- MKV y AVI pueden no funcionar en Safari o navegadores móviles
- Comprueba la consola del navegador para ver errores (F12)

### El HDD no se monta tras el reinicio
- Comprueba `/etc/fstab`: `sudo cat /etc/fstab`
- Verifica el UUID: `sudo blkid /dev/sda1`
- Monta manualmente para probar: `sudo mount -a`

### La Chat de IA no funciona
- Comprueba que Ollama esté en ejecución: `sudo systemctl status ollama`
- Reinicia Ollama: `sudo systemctl restart ollama`
- En la Pi 3B, Ollama puede tardar 30–60 segundos en cargar un modelo — ten paciencia

### Avisos de temperatura elevada
- Comprueba la temperatura: `cat /sys/class/thermal/thermal_zone0/temp` (divide entre 1000 para obtener °C)
- Añade un disipador o ventilador a la Pi — especialmente importante para el streaming de vídeo prolongado
- El throttling comienza a 80°C en la Pi 3B

---

## Uso de múltiples discos con mergerfs

Si te quedas sin espacio en el HDD, puedes añadir un segundo (o tercer) disco sin cambiar una sola línea de código. [mergerfs](https://github.com/trapexit/mergerfs) fusiona múltiples discos físicos en una única ruta virtual — el servidor sigue leyendo y escribiendo en `/mnt/hdd` exactamente igual que antes.

```
/dev/sda1 → /mnt/hdd1  (HDD antiguo)
/dev/sdb1 → /mnt/hdd2  (HDD nuevo)
/mnt/hdd  ← mergerfs   (vista unificada)
```

Los nuevos archivos se escriben automáticamente en el disco con más espacio libre. Los archivos existentes permanecen donde están.

> ⚠️ **Límite de ancho de banda USB del Pi 3B:** los 4 puertos USB comparten ~25 MB/s en total. Dos HDD conectados al mismo tiempo se dividirán ese ancho de banda.

### 1. Copiar datos al nuevo disco

Conecta ambos discos a la Pi. El nuevo aparecerá como `/dev/sdb`.

```bash
lsblk
# Verifica que el nuevo disco aparezca como /dev/sdb o /dev/sdb1
```

Si `/dev/sdb` aún no tiene partición:
```bash
sudo fdisk /dev/sdb
# pulsa: n → p → 1 → Enter → Enter → w
```

Formatea el nuevo disco (omite este paso si ya tiene tus datos):
```bash
sudo mkfs.ext4 /dev/sdb1
# ⚠ Esto borra todos los datos del nuevo disco
```

Detén el servidor, monta el nuevo disco y copia todo:
```bash
pm2 stop homelab
sudo mkdir /mnt/hdd2
sudo mount /dev/sdb1 /mnt/hdd2
sudo chown -R pi:pi /mnt/hdd2
cp -a /mnt/hdd/* /mnt/hdd2/
ls /mnt/hdd2        # verifica que los archivos hayan llegado
pm2 start homelab
```

> Si los datos ya fueron copiados desde un PC, omite los pasos `pm2 stop / cp -a / pm2 start` y ve directamente al punto 2.

### 2. Instalar mergerfs

```bash
sudo apt update && sudo apt install -y mergerfs
mergerfs --version
```

### 3. Reconfigurar los puntos de montaje

```bash
sudo mkdir -p /mnt/hdd1   # punto de montaje para el HDD antiguo
# /mnt/hdd2 ya existe del punto 1
# /mnt/hdd  ya existe

pm2 stop homelab
sudo umount /mnt/hdd
sudo mount /dev/sda1 /mnt/hdd1
sudo mount /dev/sdb1 /mnt/hdd2   # omite si ya está montado
```

### 4. Crear la vista unificada

```bash
sudo mergerfs -o defaults,allow_other,use_ino,category.create=mfs \
    /mnt/hdd1:/mnt/hdd2 /mnt/hdd
```

Verifica que funcione:
```bash
ls /mnt/hdd      # debería mostrar los archivos de ambos discos
df -h /mnt/hdd   # debería mostrar el espacio total combinado
pm2 start homelab
```

### 5. Persistencia tras los reinicios (fstab)

Encuentra los UUID de ambos discos:
```bash
sudo blkid /dev/sda1   # UUID HDD antiguo
sudo blkid /dev/sdb1   # UUID HDD nuevo
```

Edita fstab:
```bash
sudo nano /etc/fstab
```

Reemplaza la línea del único HDD existente con estas tres (usa tus UUIDs reales):
```
UUID=OLD-HDD-UUID  /mnt/hdd1  auto  defaults,nofail  0  0
UUID=NEW-HDD-UUID  /mnt/hdd2  auto  defaults,nofail  0  0
/mnt/hdd1:/mnt/hdd2  /mnt/hdd  fuse.mergerfs  defaults,allow_other,use_ino,category.create=mfs,nofail  0  0
```

Prueba y reinicia:
```bash
sudo mount -a    # sin salida = correcto
sudo reboot
```

Tras el reinicio verifica:
```bash
df -h /mnt/hdd   # debería mostrar el espacio combinado
pm2 status       # homelab debería estar online
```

### Añadir un tercer disco

Simplemente añade `/mnt/hdd3` a la línea de mergerfs en fstab:
```
/mnt/hdd1:/mnt/hdd2:/mnt/hdd3  /mnt/hdd  fuse.mergerfs  defaults,allow_other,use_ino,category.create=mfs,nofail  0  0
```

### Eliminar un disco

Mueve primero sus archivos a otro disco, luego elimínalo de fstab.

---

## Notas de Seguridad

- El servidor está diseñado para uso **solo en la red local / mediante Tailscale**. No expongas el puerto 3000 directamente a internet.
- Las sesiones se almacenan en el lado del servidor y caducan después de 7 días.
- Los ataques de path traversal están bloqueados mediante `safePath()` en el servidor.
- Cambia el `CLOUD_PASSWORD` y el `VIDEO_PIN` predeterminados antes del primer uso.
