# 🏠 Homelab

Un home server leggero e self-hosted costruito con **Node.js + Express**, progettato per girare su un Raspberry Pi o qualsiasi macchina Linux. Fornisce tre servizi attraverso un'unica interfaccia web:

- **🎬 HomeVideo** — streaming video locale (film, serie TV, video vari) con una libreria in stile Netflix, supporto per poster personalizzati ed estrazione dei sottotitoli da file MKV
- **☁️ HomeCloud** — archiviazione cloud personale con upload/download, gestione delle cartelle, anteprima inline dei file e drag-and-drop
- **🤖 HomeAI** — chat AI locale basata su [Ollama](https://ollama.com), con un selettore dinamico dei modelli

Tutti i servizi sono accessibili da qualsiasi dispositivo sulla rete locale (e da remoto tramite Tailscale). Nessun abbonamento cloud, nessuna telemetria, nessuna pubblicità.

> **Questo progetto gira su un Raspberry Pi 3B** — è l'hardware su cui è stato sviluppato e testato. HomeVideo e HomeCloud funzionano ottimamente. Anche la Chat AI funziona, ma è limitata a modelli molto piccoli a causa del vincolo di 1 GB di RAM.

---

## Requisiti Hardware

| Hardware | Requisito |
|---|---|
| **Single-board computer / PC** | Raspberry Pi 3B *(minimo)*, **Raspberry Pi 4 consigliato** |
| **Scheda microSD** | 16 GB+, Classe 10 o UHS-I |
| **Alimentatore** | 5V/2.5A microUSB (Pi 3B) o 5V/3A USB-C (Pi 4) — **non** un caricatore da telefono |
| **Cavo Ethernet** | Connessione cablata fortemente consigliata |
| **HDD esterno** | 2.5" SATA + adattatore USB, qualsiasi dimensione |
| **PC/Mac** | Per flashare la scheda SD e trasferire i file |

> **Raspberry Pi 3B vs 4:** Il Pi 3B esegue HomeVideo e HomeCloud perfettamente. Tuttavia, la sezione Chat AI richiede Ollama, che con 1 GB di RAM può eseguire solo modelli molto piccoli (es. `gemma3:1b`) — le risposte saranno lente. Un **Pi 4 (4 GB+)** o un mini-PC è fortemente consigliato se la chat AI è importante per te. Un Pi 5, un vecchio laptop o qualsiasi macchina x86 offrirà prestazioni AI notevolmente migliori.

---

## Struttura del Progetto

```
homelab/
├── server.js          ← Server Express (API + servizio file statici)
├── package.json
├── .sessions.json     ← generato automaticamente, memorizza i token di sessione attivi
└── public/
    ├── index.html     ← Pagina principale (link alle tre sezioni)
    ├── video.html     ← Interfaccia streaming video
    ├── cloud.html     ← Interfaccia cloud storage
    └── chat.html      ← Interfaccia chat AI
```

**Layout HDD** (montato su `/mnt/hdd`):
```
/mnt/hdd/
├── video/
│   ├── Film/
│   │   └── Titolo Film/
│   │       ├── film.mp4
│   │       └── cover.jpg     ← poster opzionale (rapporto 2:3 consigliato)
│   ├── Serie/
│   │   └── Nome Serie/
│   │       ├── S01E01 - Titolo Episodio.mp4
│   │       ├── S01E02 - Titolo Episodio.mp4
│   │       └── cover.jpg
│   └── Video/
│       └── qualsiasi.mp4      ← video singoli, nessuna sottocartella necessaria
└── cloud/                    ← radice dello storage HomeCloud
```

---

## Guida all'Installazione

### 1. Flash del sistema operativo

1. Scarica e installa [Raspberry Pi Imager](https://www.raspberrypi.com/software/) sul tuo PC.
2. Inserisci la scheda microSD.
3. In Raspberry Pi Imager, seleziona:
   - **Device:** Raspberry Pi 3 (o 4)
   - **OS:** Raspberry Pi OS Lite (64-bit) — senza desktop, più leggero
   - **Storage:** la tua microSD
4. Apri le **Impostazioni avanzate** (⚙) prima di scrivere e configura:
   - **Hostname:** `homelab`
   - **Abilita SSH** → autenticazione con password
   - **Username:** `pi` — scegli una password robusta
   - **Locale:** la tua regione e il layout della tastiera
   - ⚠️ **NON configurare il Wi-Fi** — usa solo ethernet per maggiore affidabilità
5. Clicca su **Write** e attendi (3–5 minuti).

---

### 2. Primo avvio e connessione SSH

1. Inserisci la microSD nel Pi, collega il cavo ethernet, poi collega l'alimentazione.
2. Attendi ~90 secondi finché il LED verde rallenta.
3. Trova l'IP del Pi: apri il pannello di amministrazione del router (di solito `192.168.1.1`) e cerca un dispositivo chiamato `homelab`.
4. Connettiti via SSH dal terminale del tuo PC:
   ```bash
   ssh pi@192.168.1.105   # sostituisci con l'IP del tuo Pi
   ```
   Digita `yes` al prompt della chiave host, poi inserisci la password.
5. Aggiorna il sistema:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

---

### 3. Impostare un IP statico

Un IP statico garantisce che il server sia sempre raggiungibile allo stesso indirizzo.

**Consigliato — Prenotazione DHCP nel router:**
1. Trova il MAC address del Pi:
   ```bash
   ip link show eth0
   # cerca la riga: link/ether xx:xx:xx:xx:xx:xx
   ```
2. Nelle impostazioni DHCP del router, associa quel MAC address a un IP fisso (es. `192.168.1.100`) e salva.
3. Riavvia il Pi:
   ```bash
   sudo reboot
   ```
4. Riconnettiti: `ssh pi@192.168.1.100`

**Alternativa — IP statico sul Pi stesso:**
```bash
sudo nano /etc/dhcpcd.conf
```
Aggiungi alla fine (adatta gli IP al tuo router):
```
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8
```
Salva con `CTRL+X → Y → Invio`, poi riavvia.

---

### 4. Installare Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node --version && npm --version
```

Dovresti vedere qualcosa come `v20.x.x` e `10.x.x`.

---

### 5. Collegare e montare l'HDD

```bash
# Verifica che il Pi rilevi il disco
lsblk
# Dovresti vedere sda / sda1
```

**Se l'HDD è NTFS (proveniente da Windows):**
```bash
sudo apt install -y ntfs-3g
```

**Se vuoi formattare l'HDD in ext4 (consigliato per Linux — più veloce e stabile):**
```bash
sudo mkfs.ext4 /dev/sda1
# ⚠ Questo cancella tutti i dati sul disco
```

**Monta e crea la struttura delle cartelle:**
```bash
sudo mkdir /mnt/hdd
sudo mount /dev/sda1 /mnt/hdd

sudo mkdir -p /mnt/hdd/video/Film
sudo mkdir -p /mnt/hdd/video/Serie
sudo mkdir -p /mnt/hdd/video/Video
sudo mkdir -p /mnt/hdd/cloud
sudo chown -R pi:pi /mnt/hdd
```

**Configura il montaggio automatico all'avvio:**
```bash
# Trova l'UUID del disco
sudo blkid /dev/sda1
# Copia il valore UUID, es. a1b2c3d4-e5f6-7890-abcd-ef1234567890

sudo nano /etc/fstab
```
Aggiungi questa riga alla fine (sostituisci `YOUR-UUID`):
```
UUID=YOUR-UUID /mnt/hdd auto defaults,nofail 0 0
```
Testalo:
```bash
sudo mount -a
# Nessun output = successo
```

---

### 6. Configurare zRAM (Consigliato per Pi 3B)

zRAM crea uno spazio di swap compresso in RAM, il che aiuta significativamente quando la memoria è sotto pressione — specialmente con il Pi 3B da 1 GB.

```bash
sudo apt install -y zram-tools
```

Modifica la configurazione:
```bash
sudo nano /etc/default/zramswap
```
Imposta (o conferma):
```
ALGO=lz4
PERCENT=50
```
Abilita e avvia:
```bash
sudo systemctl enable zramswap
sudo systemctl start zramswap
```
Verifica che sia attivo:
```bash
swapon --show
# Dovrebbe mostrare una voce /dev/zram0
```

Puoi anche aggiungere opzionalmente un file di swap sull'HDD come overflow aggiuntivo (più lento, ma utile):
```bash
sudo fallocate -l 2G /mnt/hdd/swapfile
sudo chmod 600 /mnt/hdd/swapfile
sudo mkswap /mnt/hdd/swapfile
sudo swapon /mnt/hdd/swapfile
```
Aggiungi a `/etc/fstab` per mantenerlo attivo dopo i riavvii:
```
/mnt/hdd/swapfile none swap sw 0 0
```

---

### 7. Trasferire i file del progetto

Prima, crea la struttura delle cartelle del progetto sul Pi:
```bash
mkdir ~/homelab
mkdir ~/homelab/public
```

Poi, sul tuo PC, apri un terminale nella cartella dove hai scaricato i file del progetto:
```bash
# Trasferisci server.js e package.json
scp server.js pi@192.168.1.100:~/homelab/server.js
scp package.json pi@192.168.1.100:~/homelab/package.json

# Trasferisci tutte le pagine HTML
scp public/index.html public/video.html public/cloud.html public/chat.html \
    pi@192.168.1.100:~/homelab/public/
```

Sul Pi, verifica che i file siano arrivati:
```bash
ls ~/homelab/
ls ~/homelab/public/
```

---

### 8. Configurare il server

#### Impostare le password

```bash
nano ~/homelab/server.js
```

Trova queste righe in cima al file e modificale:
```js
const CLOUD_PASSWORD = 'your-cloud-password';  // password per HomeCloud
const VIDEO_PIN      = '1234';                 // PIN numerico per HomeVideo
```
Salva con `CTRL+X → Y → Invio`.

---

### 9. Installare le dipendenze e testare

```bash
cd ~/homelab && npm install
node server.js
```

Apri un browser su qualsiasi dispositivo della tua rete e vai su:
```
http://192.168.1.100:3000
```

Se vedi la pagina principale di Homelab, tutto funziona. Premi `CTRL+C` per fermare il server.

---

### 10. Avvio automatico con PM2

PM2 è un process manager che mantiene il server in esecuzione 24/7 e lo riavvia automaticamente dopo ogni reboot.

```bash
# Installa PM2 globalmente
sudo npm install -g pm2

# Avvia il server
cd ~/homelab && pm2 start server.js --name homelab

# Verifica che sia in esecuzione
pm2 status

# Configura PM2 per avviarsi al boot
pm2 startup
# Copia ed esegui il comando che viene stampato (sarà simile a):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pi --hp /home/pi

# Salva la lista dei processi correnti
pm2 save
```

Riavvia per confermare che tutto parta automaticamente:
```bash
sudo reboot
# Attendi 60 secondi, poi:
ssh pi@192.168.1.100
pm2 status
# homelab dovrebbe risultare "online"
```

**Comandi PM2 utili:**
```bash
pm2 logs homelab       # log in tempo reale (CTRL+C per uscire)
pm2 restart homelab    # riavvia dopo aver modificato i file
pm2 stop homelab       # ferma il server
pm2 status             # stato di tutti i processi
```

---

### 11. Accesso remoto con Tailscale (Opzionale)

[Tailscale](https://tailscale.com) crea una VPN privata tra i tuoi dispositivi, permettendoti di accedere all'homelab da qualsiasi luogo senza port forwarding o esporre nulla su internet.

**Sul Pi:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Segui il link di autenticazione stampato nel terminale, poi annota l'IP Tailscale assegnato al Pi (visibile su [tailscale.com/admin](https://login.tailscale.com/admin/machines) o tramite `tailscale ip`).

**Su ogni dispositivo client** (telefono, laptop, ecc.): installa l'app Tailscale e accedi con lo stesso account.

Una volta connesso, puoi accedere all'homelab da qualsiasi luogo usando:
```
http://<tailscale-ip>:3000
```

> **Nota:** Tailscale è gratuito per uso personale (fino a 3 utenti, 100 dispositivi).

---

### 12. Installare Ollama e un modello (Chat AI)

> ⚠️ Il Pi 3B ha solo 1 GB di RAM. Funzioneranno solo i modelli più piccoli (`gemma3:1b`, ~800 MB) e le risposte saranno lente. Un **Pi 4 con 4 GB+ di RAM** o una macchina più potente è fortemente consigliato per una buona esperienza di chat AI.

```bash
# Installa Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Scarica il modello più leggero (funziona su Pi 3B)
ollama pull gemma3:1b

# Testalo
ollama run gemma3:1b
# Digita un messaggio, premi Invio. Digita /bye per uscire.
```

Verifica che Ollama sia in esecuzione e raggiungibile:
```bash
curl http://localhost:11434/api/tags
# Dovrebbe restituire una lista JSON dei modelli installati
```

È tutto. La pagina Chat AI comunica con Ollama attraverso il proxy del server Node.js (`/api/chat/tags` e `/api/chat/send`), che si connette a `localhost:11434` sul Pi. Questo significa:
- Nessuna configurazione IP necessaria in alcun file
- Ollama è in ascolto solo su localhost — non viene mai esposto sulla rete
- Tutto funziona in modo trasparente sia sulla rete locale che da remoto via Tailscale

Tutti i modelli aggiuntivi scaricati con `ollama pull` appariranno automaticamente nel selettore dei modelli.

**Suggerimenti di modelli per hardware:**
| Hardware | Modello consigliato |
|---|---|
| Pi 3B (1 GB RAM) | `gemma3:1b` |
| Pi 4 (4 GB RAM) | `gemma3:4b`, `llama3.2:3b` |
| Pi 4/5 (8 GB RAM) o mini-PC | `llama3.1:8b`, `mistral:7b` |

---

## Aggiungere contenuti a HomeVideo

### Film

Ogni film deve trovarsi nella propria sottocartella all'interno di `Film/`:

```bash
# Crea la cartella
mkdir -p /mnt/hdd/video/Film/Inception

# Copia il video (dal PC via SCP)
scp /path/to/inception.mp4 pi@192.168.1.100:/mnt/hdd/video/Film/Inception/

# Opzionale: aggiungi un poster (il nome deve essere cover.jpg, rapporto 2:3)
scp cover.jpg pi@192.168.1.100:/mnt/hdd/video/Film/Inception/
```

### Serie TV

Gli episodi devono seguire il formato di denominazione `S01E01` affinché il server possa raggrupparli per stagione:

```bash
mkdir -p /mnt/hdd/video/Serie/Breaking\ Bad
scp S01E01\ -\ Pilot.mp4 S01E02\ -\ ....mp4 \
    pi@192.168.1.100:/mnt/hdd/video/Serie/Breaking\ Bad/
```

### Formati video supportati

| Formato | Compatibilità |
|---|---|
| **MP4 (H.264)** | ✅ Tutti i browser — consigliato |
| MKV | ⚠️ Maggior parte dei browser desktop; potrebbe non funzionare su Safari/iOS |
| AVI, MOV | ⚠️ Supporto browser limitato |
| WebM | ✅ Buon supporto browser |

> Per la massima compatibilità, converti altri formati in MP4 H.264 usando **HandBrake** (gratuito).

### Sottotitoli MKV

Se `ffmpeg` è installato sul Pi, il lettore video offrirà automaticamente le tracce dei sottotitoli incorporati nei file MKV tramite il pulsante **CC**. Installalo con:
```bash
sudo apt install -y ffmpeg
```

---

## Sostituire o aggiornare l'HDD

Quando vuoi un disco più capiente:

1. Copia tutti i file dal vecchio HDD al nuovo tramite il tuo PC.
2. Collega il nuovo HDD al Pi.
3. Trova il nuovo UUID: `sudo blkid /dev/sda1`
4. Aggiorna `/etc/fstab` con il nuovo UUID (sostituisci la vecchia riga).
5. Testa: `sudo mount -a`
6. Riavvia: `sudo reboot`

Il server legge sempre da `/mnt/hdd/` — nessun'altra modifica è necessaria.

---

## Risoluzione dei Problemi

### SSH non si connette
- Verifica che il Pi sia acceso e che il LED verde stia lampeggiando
- Trova il suo IP nella lista dei dispositivi del router
- Testa con: `ping 192.168.1.100`
- Se hai cambiato IP: `ssh-keygen -R vecchio_ip`

### Il browser non carica la pagina
- Controlla che PM2 sia in esecuzione: `pm2 status`
- Controlla i log: `pm2 logs homelab`
- Assicurati di includere la porta: `http://192.168.1.100:3000`
- Il tuo dispositivo deve essere sulla stessa rete (o connesso via Tailscale)

### I video non appaiono nella libreria
- Verifica che l'HDD sia montato: `df -h | grep hdd`
- Controlla la struttura delle cartelle: `ls /mnt/hdd/video/Film/`
- Ogni film **deve** essere nella propria sottocartella all'interno di `Film/`
- Riavvia il server dopo aver aggiunto i file: `pm2 restart homelab`

### Il video non viene riprodotto
- MP4 con codec H.264 ha la compatibilità più ampia — converti con HandBrake
- MKV e AVI potrebbero non funzionare su Safari o browser mobile
- Controlla la console del browser per eventuali errori (F12)

### L'HDD non si monta dopo il riavvio
- Controlla `/etc/fstab`: `sudo cat /etc/fstab`
- Verifica l'UUID: `sudo blkid /dev/sda1`
- Monta manualmente per testare: `sudo mount -a`

### La Chat AI non funziona
- Controlla che Ollama sia in esecuzione: `sudo systemctl status ollama`
- Riavvia Ollama: `sudo systemctl restart ollama`
- Sul Pi 3B, Ollama può impiegare 30–60 secondi per caricare un modello — sii paziente

### Avvisi di temperatura elevata
- Controlla la temperatura: `cat /sys/class/thermal/thermal_zone0/temp` (dividi per 1000 per ottenere °C)
- Aggiungi un dissipatore o una ventola al Pi — particolarmente importante per lo streaming video prolungato
- Il throttling inizia a 80°C sul Pi 3B

---

## Utilizzo di più dischi con mergerfs

Se esaurisci lo spazio sull'HDD, puoi aggiungere un secondo (o terzo) disco senza cambiare una sola riga di codice. [mergerfs](https://github.com/trapexit/mergerfs) unisce più dischi fisici in un unico percorso virtuale — il server continua a leggere e scrivere su `/mnt/hdd` esattamente come prima.

```
/dev/sda1 → /mnt/hdd1  (vecchio HDD)
/dev/sdb1 → /mnt/hdd2  (nuovo HDD)
/mnt/hdd  ← mergerfs   (vista unificata)
```

I nuovi file vengono scritti automaticamente sul disco con più spazio libero. I file esistenti rimangono dove si trovano.

> ⚠️ **Limite di banda USB del Pi 3B:** le 4 porte USB condividono ~25 MB/s totali. Due HDD collegati contemporaneamente si divideranno quella banda.

### 1. Copiare i dati sul nuovo disco

Collega entrambi i dischi al Pi. Il nuovo apparirà come `/dev/sdb`.

```bash
lsblk
# Verifica che il nuovo disco appaia come /dev/sdb o /dev/sdb1
```

Se `/dev/sdb` non ha ancora una partizione:
```bash
sudo fdisk /dev/sdb
# premi: n → p → 1 → Invio → Invio → w
```

Formatta il nuovo disco (salta se contiene già i tuoi dati):
```bash
sudo mkfs.ext4 /dev/sdb1
# ⚠ Questo cancella tutti i dati sul nuovo disco
```

Ferma il server, monta il nuovo disco e copia tutto:
```bash
pm2 stop homelab
sudo mkdir /mnt/hdd2
sudo mount /dev/sdb1 /mnt/hdd2
sudo chown -R pi:pi /mnt/hdd2
cp -a /mnt/hdd/* /mnt/hdd2/
ls /mnt/hdd2        # verifica che i file siano arrivati
pm2 start homelab
```

> Se i dati erano già stati copiati da un PC, salta i passaggi `pm2 stop / cp -a / pm2 start` e vai direttamente al punto 2.

### 2. Installare mergerfs

```bash
sudo apt update && sudo apt install -y mergerfs
mergerfs --version
```

### 3. Riconfigurare i punti di mount

```bash
sudo mkdir -p /mnt/hdd1   # punto di mount per il vecchio HDD
# /mnt/hdd2 esiste già dal punto 1
# /mnt/hdd  esiste già

pm2 stop homelab
sudo umount /mnt/hdd
sudo mount /dev/sda1 /mnt/hdd1
sudo mount /dev/sdb1 /mnt/hdd2   # salta se già montato
```

### 4. Creare la vista unificata

```bash
sudo mergerfs -o defaults,allow_other,use_ino,category.create=mfs \
    /mnt/hdd1:/mnt/hdd2 /mnt/hdd
```

Verifica che funzioni:
```bash
ls /mnt/hdd      # dovrebbe mostrare i file di entrambi i dischi
df -h /mnt/hdd   # dovrebbe mostrare lo spazio totale combinato
pm2 start homelab
```

### 5. Persistenza dopo i riavvii (fstab)

Trova gli UUID di entrambi i dischi:
```bash
sudo blkid /dev/sda1   # UUID vecchio HDD
sudo blkid /dev/sdb1   # UUID nuovo HDD
```

Modifica fstab:
```bash
sudo nano /etc/fstab
```

Sostituisci la riga del singolo HDD esistente con queste tre (usa i tuoi UUID reali):
```
UUID=OLD-HDD-UUID  /mnt/hdd1  auto  defaults,nofail  0  0
UUID=NEW-HDD-UUID  /mnt/hdd2  auto  defaults,nofail  0  0
/mnt/hdd1:/mnt/hdd2  /mnt/hdd  fuse.mergerfs  defaults,allow_other,use_ino,category.create=mfs,nofail  0  0
```

Testa e riavvia:
```bash
sudo mount -a    # nessun output = corretto
sudo reboot
```

Dopo il riavvio verifica:
```bash
df -h /mnt/hdd   # dovrebbe mostrare lo spazio combinato
pm2 status       # homelab dovrebbe essere online
```

### Aggiungere un terzo disco

Aggiungi semplicemente `/mnt/hdd3` alla riga di mergerfs in fstab:
```
/mnt/hdd1:/mnt/hdd2:/mnt/hdd3  /mnt/hdd  fuse.mergerfs  defaults,allow_other,use_ino,category.create=mfs,nofail  0  0
```

### Rimuovere un disco

Sposta prima i suoi file su un altro disco, poi rimuovilo da fstab.

---

## Note sulla Sicurezza

- Il server è progettato per essere usato **solo sulla rete locale / via Tailscale**. Non esporre la porta 3000 direttamente su internet.
- Le sessioni sono memorizzate lato server e scadono dopo 7 giorni.
- Gli attacchi di path traversal sono bloccati tramite `safePath()` nel server.
- Cambia il `CLOUD_PASSWORD` e il `VIDEO_PIN` predefiniti prima del primo utilizzo.
