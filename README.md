# 🏠 Homelab

A self-hosted, lightweight home server built with **Node.js + Express**, designed to run on a Raspberry Pi or any Linux machine. Provides three services through a single clean web interface:

- **🎬 HomeVideo** — local video streaming (films, TV series, miscellaneous videos) with a Netflix-style library, custom poster support, and MKV subtitle extraction
- **☁️ HomeCloud** — personal cloud storage with upload/download, folder management, inline file preview, and drag-and-drop
- **🤖 HomeAI** — local AI chat powered by [Ollama](https://ollama.com), with a dynamic model selector

All services are accessible from any device on your local network (and remotely via Tailscale). No cloud subscriptions, no telemetry, no ads.

> **This project runs on a Raspberry Pi 3B** — that's the hardware it was developed and tested on. HomeVideo and HomeCloud work great on it. The AI Chat works too, but is limited to very small models due to the 1 GB RAM constraint.

---

## Hardware Requirements

| Hardware | Requirement |
|---|---|
| **Single-board computer / PC** | Raspberry Pi 3B *(minimum)*, **Raspberry Pi 4 recommended** |
| **MicroSD card** | 16 GB+, Class 10 or UHS-I |
| **Power supply** | 5V/2.5A microUSB (Pi 3B) or 5V/3A USB-C (Pi 4) — **not** a phone charger |
| **Ethernet cable** | Wired connection strongly recommended |
| **External HDD** | 2.5" SATA + USB adapter, any size |
| **PC/Mac** | For flashing the SD card and transferring files |

> **Raspberry Pi 3B vs 4:** The Pi 3B runs HomeVideo and HomeCloud perfectly fine. However, the AI Chat section requires Ollama, which can only run very small models (e.g. `gemma3:1b`) on 1 GB RAM — responses will be slow. A **Pi 4 (4 GB+)** or a mini-PC is strongly recommended if AI chat is important to you. A Pi 5, an old laptop, or any x86 machine will give much better AI performance.

---

## Project Structure

```
homelab/
├── server.js          ← Express server (API + static file serving)
├── package.json
├── .sessions.json     ← auto-generated, stores active session tokens
└── public/
    ├── index.html     ← Home page (links to the three sections)
    ├── video.html     ← Video streaming interface
    ├── cloud.html     ← Cloud storage interface
    └── chat.html      ← AI chat interface
```

**HDD layout** (mounted at `/mnt/hdd`):
```
/mnt/hdd/
├── video/
│   ├── Film/
│   │   └── Movie Title/
│   │       ├── movie.mp4
│   │       └── cover.jpg     ← optional poster (2:3 ratio recommended)
│   ├── Serie/
│   │   └── Series Name/
│   │       ├── S01E01 - Episode Title.mp4
│   │       ├── S01E02 - Episode Title.mp4
│   │       └── cover.jpg
│   └── Video/
│       └── anything.mp4      ← standalone videos, no subfolder needed
└── cloud/                    ← HomeCloud storage root
```

---

## Setup Guide

### 1. Flash the OS

1. Download and install [Raspberry Pi Imager](https://www.raspberrypi.com/software/) on your PC.
2. Insert the microSD card.
3. In Raspberry Pi Imager, select:
   - **Device:** Raspberry Pi 3 (or 4)
   - **OS:** Raspberry Pi OS Lite (64-bit) — no desktop, lighter
   - **Storage:** your microSD
4. Open **Advanced settings** (⚙) before writing and configure:
   - **Hostname:** `homelab`
   - **Enable SSH** → password authentication
   - **Username:** `pi` — choose a strong password
   - **Locale:** your region and keyboard layout
   - ⚠️ **Do NOT configure Wi-Fi** — use ethernet only for reliability
5. Click **Write** and wait (3–5 minutes).

---

### 2. First Boot and SSH Connection

1. Insert the microSD into the Pi, connect the ethernet cable, then plug in power.
2. Wait ~90 seconds until the green LED slows down.
3. Find the Pi's IP: open your router admin panel (usually `192.168.1.1`) and look for a device named `homelab`.
4. Connect via SSH from your PC terminal:
   ```bash
   ssh pi@192.168.1.105   # replace with your Pi's IP
   ```
   Type `yes` at the host key prompt, then enter your password.
5. Update the system:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

---

### 3. Set a Static IP

A static IP ensures the server is always reachable at the same address.

**Recommended — DHCP reservation in the router:**
1. Find the Pi's MAC address:
   ```bash
   ip link show eth0
   # look for the line: link/ether xx:xx:xx:xx:xx:xx
   ```
2. In your router's DHCP settings, bind that MAC address to a fixed IP (e.g. `192.168.1.100`) and save.
3. Reboot the Pi:
   ```bash
   sudo reboot
   ```
4. Reconnect: `ssh pi@192.168.1.100`

**Alternative — static IP on the Pi itself:**
```bash
sudo nano /etc/dhcpcd.conf
```
Add at the end (adjust IPs to match your router):
```
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8
```
Save with `CTRL+X → Y → Enter`, then reboot.

---

### 4. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node --version && npm --version
```

You should see something like `v20.x.x` and `10.x.x`.

---

### 5. Connect and Mount the HDD

```bash
# Check the Pi sees the drive
lsblk
# You should see sda / sda1
```

**If the HDD is NTFS (came from Windows):**
```bash
sudo apt install -y ntfs-3g
```

**If you want to format the HDD to ext4 (recommended for Linux — faster and more stable):**
```bash
sudo mkfs.ext4 /dev/sda1
# ⚠ This wipes all data on the drive
```

**Mount and create folder structure:**
```bash
sudo mkdir /mnt/hdd
sudo mount /dev/sda1 /mnt/hdd

sudo mkdir -p /mnt/hdd/video/Film
sudo mkdir -p /mnt/hdd/video/Serie
sudo mkdir -p /mnt/hdd/video/Video
sudo mkdir -p /mnt/hdd/cloud
sudo chown -R pi:pi /mnt/hdd
```

**Configure automount on boot:**
```bash
# Find the drive's UUID
sudo blkid /dev/sda1
# Copy the UUID value, e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890

sudo nano /etc/fstab
```
Add this line at the end (replace `YOUR-UUID`):
```
UUID=YOUR-UUID /mnt/hdd auto defaults,nofail 0 0
```
Test it:
```bash
sudo mount -a
# No output = success
```

---

### 6. Set Up zRAM (Recommended for Pi 3B)

zRAM creates a compressed swap space in RAM, which significantly helps when memory gets tight — especially on the Pi 3B's 1 GB.

```bash
sudo apt install -y zram-tools
```

Edit the config:
```bash
sudo nano /etc/default/zramswap
```
Set (or confirm):
```
ALGO=lz4
PERCENT=50
```
Enable and start:
```bash
sudo systemctl enable zramswap
sudo systemctl start zramswap
```
Verify it's active:
```bash
swapon --show
# Should show a /dev/zram0 entry
```

You can optionally also add a swap file on the HDD for extra overflow (slower, but useful):
```bash
sudo fallocate -l 2G /mnt/hdd/swapfile
sudo chmod 600 /mnt/hdd/swapfile
sudo mkswap /mnt/hdd/swapfile
sudo swapon /mnt/hdd/swapfile
```
Add to `/etc/fstab` to persist across reboots:
```
/mnt/hdd/swapfile none swap sw 0 0
```

---

### 7. Transfer Project Files

First, create the project folder structure on the Pi:
```bash
mkdir ~/homelab
mkdir ~/homelab/public
```

Then, on your PC, open a terminal in the folder where you downloaded the project files:
```bash
# Transfer server.js and package.json
scp server.js pi@192.168.1.100:~/homelab/server.js
scp package.json pi@192.168.1.100:~/homelab/package.json

# Transfer all HTML pages
scp public/index.html public/video.html public/cloud.html public/chat.html \
    pi@192.168.1.100:~/homelab/public/
```

On the Pi, verify the files arrived:
```bash
ls ~/homelab/
ls ~/homelab/public/
```

---

### 8. Configure the Server

#### Set passwords

```bash
nano ~/homelab/server.js
```

Find these lines near the top and edit them:
```js
const CLOUD_PASSWORD = 'your-cloud-password';  // password for HomeCloud
const VIDEO_PIN      = '1234';                 // numeric PIN for HomeVideo
```
Save with `CTRL+X → Y → Enter`.

---

### 9. Install Dependencies and Test

```bash
cd ~/homelab && npm install
node server.js
```

Open a browser on any device on your network and go to:
```
http://192.168.1.100:3000
```

If you see the Homelab home page, everything is working. Press `CTRL+C` to stop the server.

---

### 10. Autostart with PM2

PM2 is a process manager that keeps the server running 24/7 and restarts it automatically after reboots.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the server
cd ~/homelab && pm2 start server.js --name homelab

# Check it's running
pm2 status

# Configure PM2 to start on boot
pm2 startup
# Copy and run the command it prints (it will look like):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pi --hp /home/pi

# Save the current process list
pm2 save
```

Reboot to confirm everything starts automatically:
```bash
sudo reboot
# Wait 60 seconds, then:
ssh pi@192.168.1.100
pm2 status
# homelab should show as "online"
```

**Useful PM2 commands:**
```bash
pm2 logs homelab       # real-time logs (CTRL+C to exit)
pm2 restart homelab    # restart after editing files
pm2 stop homelab       # stop the server
pm2 status             # status of all processes
```

---

### 11. Remote Access with Tailscale (Optional)

[Tailscale](https://tailscale.com) creates a private VPN between your devices, letting you access the homelab from anywhere without port forwarding or exposing anything to the internet.

**On the Pi:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Follow the authentication link printed in the terminal, then note the Tailscale IP assigned to the Pi (visible at [tailscale.com/admin](https://login.tailscale.com/admin/machines) or via `tailscale ip`).

**On each client device** (phone, laptop, etc.): install the Tailscale app and sign in to the same account.

Once connected, you can access the homelab from anywhere using:
```
http://<tailscale-ip>:3000
```

> **Note:** Tailscale is free for personal use (up to 3 users, 100 devices).

---

### 12. Install Ollama and a Model (AI Chat)

> ⚠️ The Pi 3B has only 1 GB RAM. Only the smallest models (`gemma3:1b`, ~800 MB) will work, and responses will be slow. A **Pi 4 with 4 GB+ RAM** or a more powerful machine is strongly recommended for a good AI chat experience.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the lightest model (works on Pi 3B)
ollama pull gemma3:1b

# Test it
ollama run gemma3:1b
# Type a message, press Enter. Type /bye to exit.
```

Verify Ollama is running and reachable:
```bash
curl http://localhost:11434/api/tags
# Should return a JSON list of installed models
```

That's all. The AI Chat page communicates with Ollama through the Node.js server proxy (`/api/chat/tags` and `/api/chat/send`), which connects to `localhost:11434` on the Pi. This means:
- No IP configuration needed in any file
- Ollama only listens on localhost — it is never exposed on the network
- Everything works transparently both on your local network and remotely via Tailscale

Any additional models you pull with `ollama pull` will appear automatically in the model selector.

**Model suggestions by hardware:**
| Hardware | Recommended model |
|---|---|
| Pi 3B (1 GB RAM) | `gemma3:1b` |
| Pi 4 (4 GB RAM) | `gemma3:4b`, `llama3.2:3b` |
| Pi 4/5 (8 GB RAM) or mini-PC | `llama3.1:8b`, `mistral:7b` |

---

## Adding Content to HomeVideo

### Films

Each film must live in its own subfolder inside `Film/`:

```bash
# Create the folder
mkdir -p /mnt/hdd/video/Film/Inception

# Copy the video (from PC via SCP)
scp /path/to/inception.mp4 pi@192.168.1.100:/mnt/hdd/video/Film/Inception/

# Optional: add a poster (name must be cover.jpg, 2:3 ratio)
scp cover.jpg pi@192.168.1.100:/mnt/hdd/video/Film/Inception/
```

### TV Series

Episodes must follow the `S01E01` naming format so the server can group them by season:

```bash
mkdir -p /mnt/hdd/video/Serie/Breaking\ Bad
scp S01E01\ -\ Pilot.mp4 S01E02\ -\ ....mp4 \
    pi@192.168.1.100:/mnt/hdd/video/Serie/Breaking\ Bad/
```

### Supported Video Formats

| Format | Compatibility |
|---|---|
| **MP4 (H.264)** | ✅ All browsers — recommended |
| MKV | ⚠️ Most desktop browsers; may fail on Safari/iOS |
| AVI, MOV | ⚠️ Limited browser support |
| WebM | ✅ Good browser support |

> For maximum compatibility, convert other formats to H.264 MP4 using **HandBrake** (free).

### MKV Subtitles

If `ffmpeg` is installed on the Pi, the video player will automatically offer embedded subtitle tracks for MKV files via the **CC** button. Install it with:
```bash
sudo apt install -y ffmpeg
```

---

## Replacing or Upgrading the HDD

When you want a larger drive:

1. Copy all files from the old HDD to the new one on your PC.
2. Connect the new HDD to the Pi.
3. Find the new UUID: `sudo blkid /dev/sda1`
4. Update `/etc/fstab` with the new UUID (replace the old line).
5. Test: `sudo mount -a`
6. Reboot: `sudo reboot`

The server always reads from `/mnt/hdd/` — no other changes needed.

---

## Troubleshooting

### SSH won't connect
- Check the Pi is powered and the green LED is blinking
- Find its IP in your router's device list
- Test with: `ping 192.168.1.100`
- If you changed IP: `ssh-keygen -R old_ip`

### Browser can't load the page
- Check PM2 is running: `pm2 status`
- Check logs: `pm2 logs homelab`
- Make sure you include the port: `http://192.168.1.100:3000`
- Your device must be on the same network (or connected via Tailscale)

### Videos don't appear in the library
- Verify the HDD is mounted: `df -h | grep hdd`
- Check the folder structure: `ls /mnt/hdd/video/Film/`
- Each film **must** be in its own subfolder inside `Film/`
- Restart the server after adding files: `pm2 restart homelab`

### Video won't play
- MP4 with H.264 codec has the widest compatibility — convert with HandBrake
- MKV and AVI may not work in Safari or mobile browsers
- Check the browser console for errors (F12)

### HDD doesn't mount after reboot
- Check `/etc/fstab`: `sudo cat /etc/fstab`
- Verify the UUID: `sudo blkid /dev/sda1`
- Mount manually to test: `sudo mount -a`

### AI Chat doesn't work
- Check Ollama is running: `sudo systemctl status ollama`
- Restart Ollama: `sudo systemctl restart ollama`
- On Pi 3B, Ollama can take 30–60 seconds to load a model — be patient

### High temperature warnings
- Check the temperature: `cat /sys/class/thermal/thermal_zone0/temp` (divide by 1000 for °C)
- Add a heatsink or fan to the Pi — especially important for sustained video streaming
- Throttling starts at 80°C on the Pi 3B

---

## Using Multiple Drives with mergerfs

If you run out of space on your HDD, you can add a second (or third) drive without changing a single line of code. [mergerfs](https://github.com/trapexit/mergerfs) merges multiple physical drives into a single virtual path — the server keeps reading and writing to `/mnt/hdd` exactly as before.

```
/dev/sda1 → /mnt/hdd1  (old HDD)
/dev/sdb1 → /mnt/hdd2  (new HDD)
/mnt/hdd  ← mergerfs   (unified view)
```

New files are automatically written to whichever drive has the most free space. Existing files stay where they are.

> ⚠️ **Pi 3B USB bandwidth limit:** the 4 USB ports share ~25 MB/s total. Two HDDs connected at the same time will split that bandwidth between them.

### 1. Copy data to the new drive

Connect both drives to the Pi. The new one will appear as `/dev/sdb`.

```bash
lsblk
# Verify the new drive appears as /dev/sdb or /dev/sdb1
```

If `/dev/sdb` has no partition yet:
```bash
sudo fdisk /dev/sdb
# press: n → p → 1 → Enter → Enter → w
```

Format the new drive (skip if it already has your data on it):
```bash
sudo mkfs.ext4 /dev/sdb1
# ⚠ This wipes all data on the new drive
```

Stop the server, mount the new drive and copy everything across:
```bash
pm2 stop homelab
sudo mkdir /mnt/hdd2
sudo mount /dev/sdb1 /mnt/hdd2
sudo chown -R pi:pi /mnt/hdd2
cp -a /mnt/hdd/* /mnt/hdd2/
ls /mnt/hdd2        # verify files arrived
pm2 start homelab
```

> If the data was already copied from a PC, skip the `pm2 stop / cp -a / pm2 start` steps and go straight to step 2.

### 2. Install mergerfs

```bash
sudo apt update && sudo apt install -y mergerfs
mergerfs --version
```

### 3. Reconfigure mount points

```bash
sudo mkdir -p /mnt/hdd1   # mount point for old HDD
# /mnt/hdd2 already exists from step 1
# /mnt/hdd  already exists

pm2 stop homelab
sudo umount /mnt/hdd
sudo mount /dev/sda1 /mnt/hdd1
sudo mount /dev/sdb1 /mnt/hdd2   # skip if already mounted
```

### 4. Create the unified view

```bash
sudo mergerfs -o defaults,allow_other,use_ino,category.create=mfs \
    /mnt/hdd1:/mnt/hdd2 /mnt/hdd
```

Verify it works:
```bash
ls /mnt/hdd      # should show files from both drives
df -h /mnt/hdd   # should show combined total space
pm2 start homelab
```

### 5. Persist across reboots (fstab)

Find the UUIDs of both drives:
```bash
sudo blkid /dev/sda1   # old HDD UUID
sudo blkid /dev/sdb1   # new HDD UUID
```

Edit fstab:
```bash
sudo nano /etc/fstab
```

Replace the existing single HDD line with these three (use your actual UUIDs):
```
UUID=OLD-HDD-UUID  /mnt/hdd1  auto  defaults,nofail  0  0
UUID=NEW-HDD-UUID  /mnt/hdd2  auto  defaults,nofail  0  0
/mnt/hdd1:/mnt/hdd2  /mnt/hdd  fuse.mergerfs  defaults,allow_other,use_ino,category.create=mfs,nofail  0  0
```

Test and reboot:
```bash
sudo mount -a    # no output = correct
sudo reboot
```

After reboot verify:
```bash
df -h /mnt/hdd   # should show combined space
pm2 status       # homelab should be online
```

### Adding a third drive

Just add `/mnt/hdd3` to the mergerfs line in fstab:
```
/mnt/hdd1:/mnt/hdd2:/mnt/hdd3  /mnt/hdd  fuse.mergerfs  defaults,allow_other,use_ino,category.create=mfs,nofail  0  0
```

### Removing a drive

Move its files to another drive first, then remove it from fstab.

---

## Security Notes

- The server is designed for **local network / Tailscale use only**. Do not expose port 3000 directly to the internet.
- Sessions are stored server-side and expire after 7 days.
- Path traversal attacks are blocked via `safePath()` in the server.
- Change the default `CLOUD_PASSWORD` and `VIDEO_PIN` before first use.

