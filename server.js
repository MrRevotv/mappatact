require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

const sessionMiddleware = session({ secret: process.env.SESSION_SECRET || 'tattico-segreto-123', resave: false, saveUninitialized: false });
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
io.engine.use(sessionMiddleware);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const response = await axios.get(`https://discord.com/api/users/@me/guilds/${process.env.GUILD_ID}/member`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const roles = response.data.roles;
        let assignedRole = 'operatore';
        if (profile.id === process.env.CREATOR_USER_ID || roles.includes(process.env.ADMIN_ROLE_ID)) assignedRole = 'admin';
        else if (roles.includes(process.env.RESPONSABILE_ROLE_ID)) assignedRole = 'responsabile';
        else if (roles.includes(process.env.PLSE_ROLE_ID)) assignedRole = 'p-lse';
        return done(null, { id: profile.id, nome: response.data.nick || profile.username, ruolo: assignedRole });
    } catch (e) {
        console.error("ERRORE LOGIN DISCORD:", e.response ? e.response.data : e.message);
        return done(null, false);
    }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/api/me', (req, res) => req.isAuthenticated() ? res.json(req.user) : res.status(401).send());
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));

// --- CONFIGURAZIONE UPLOAD (Usa una cartella temporanea) ---
const tempUploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(tempUploadDir)) fs.mkdirSync(tempUploadDir);
const upload = multer({ dest: 'uploads/' });

// --- NUOVA GESTIONE LETTURA MAPPE ---
app.get('/api/lista-mappe', (req, res) => {
    const { gioco, sistema } = req.query;
    let basePath = path.join(__dirname, 'public', 'Mappe');

    // Costruisce il percorso in base al gioco e sistema
    if (gioco === 'sc') basePath = path.join(basePath, 'Star Citizen', sistema || 'Stanton');
    else if (gioco === 'arma') basePath = path.join(basePath, 'Arma');
    else basePath = path.join(basePath, 'General');

    // Se la cartella di base non esiste ancora, restituisci array vuoti
    if (!fs.existsSync(basePath)) return res.json({ master: [], submaps: {} });

    const result = { master: [], submaps: {} };

    // Legge tutte le cartelle dentro il percorso (Es: Hathor_Aberdeen)
    const cartelleMappe = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    cartelleMappe.forEach(cartella => {
        // Cerca la mappa master dentro la sottocartella mappa_master
        const masterDir = path.join(basePath, cartella, 'mappa_master');
        if (fs.existsSync(masterDir)) {
            const files = fs.readdirSync(masterDir).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
            if (files.length > 0) result.master.push({ nomeDir: cartella, file: files[0] });
        }

        // Cerca le sottomappe libere nella cartella principale (escludendo mappa_master)
        const cartellaDir = path.join(basePath, cartella);
        const subFiles = fs.readdirSync(cartellaDir).filter(f => !fs.statSync(path.join(cartellaDir, f)).isDirectory() && (f.endsWith('.jpg') || f.endsWith('.png')));
        result.submaps[cartella] = subFiles;
    });

    res.json(result);
});

// --- NUOVA GESTIONE UPLOAD MAPPE (Crea cartelle automaticamente) ---
app.post('/upload-mappa', upload.single('nuovaMappa'), (req, res) => {
    if (!req.isAuthenticated() || !['admin', 'responsabile'].includes(req.user.ruolo)) return res.sendStatus(403);

    const { tipo, gioco, sistema, mappaPrincipale } = req.body;
    const tempPath = req.file.path;
    const originalName = req.file.originalname.replace(/\s+/g, '-'); // Togli spazi dal nome

    let targetDir = path.join(__dirname, 'public', 'Mappe');

    // Naviga nella struttura base
    if (gioco === 'sc') targetDir = path.join(targetDir, 'Star Citizen', sistema || 'Stanton');
    else if (gioco === 'arma') targetDir = path.join(targetDir, 'Arma');
    else targetDir = path.join(targetDir, 'General');

    // Crea la gerarchia della mappa
    if (tipo === 'master') {
        let nomeCartella = originalName.replace(/\.[^/.]+$/, ""); // Es: "Hathor-Aberdeen"
        targetDir = path.join(targetDir, nomeCartella, 'mappa_master');
    } else if (tipo === 'submap') {
        targetDir = path.join(targetDir, mappaPrincipale); // Va direttamente nella cartella creata dalla master
    }

    // Se le cartelle non esistono, le crea tutte!
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // Sposta il file dalla cartella temporanea alla destinazione finale
    const finalPath = path.join(targetDir, originalName);
    fs.renameSync(tempPath, finalPath);

    logEvento(`[SISTEMA] L'Ufficiale ${req.user.nome} ha caricato una mappa: ${originalName}`);
    res.sendStatus(200);
});

// --- ELIMINAZIONE MAPPE E CARTELLE ---
app.delete('/api/elimina-mappa', (req, res) => {
    if (!req.isAuthenticated() || !['admin', 'responsabile'].includes(req.user.ruolo)) return res.sendStatus(403);

    const { gioco, sistema, mappaPrincipale, sottomappa } = req.query;
    if (!mappaPrincipale) return res.sendStatus(400);

    let targetDir = path.join(__dirname, 'public', 'Mappe');

    // Trova la cartella del gioco
    if (gioco === 'sc') targetDir = path.join(targetDir, 'Star Citizen', sistema || 'Stanton');
    else if (gioco === 'arma') targetDir = path.join(targetDir, 'Arma');
    else targetDir = path.join(targetDir, 'General');

    try {
        if (sottomappa) {
            // ELIMINA SOLO LA SOTTOMAPPA
            const fileTarget = path.join(targetDir, mappaPrincipale, sottomappa);
            if (fs.existsSync(fileTarget)) fs.unlinkSync(fileTarget);
            logEvento(`[SISTEMA] L'Ufficiale ${req.user.nome} ha eliminato la sottomappa ${sottomappa}`);
        } else {
            // ELIMINA L'INTERA CARTELLA DELLA MAPPA (Master + Tutte le Sottomappe)
            const folderTarget = path.join(targetDir, mappaPrincipale);
            if (fs.existsSync(folderTarget)) {
                fs.rmSync(folderTarget, { recursive: true, force: true });
            }
            logEvento(`[SISTEMA] L'Ufficiale ${req.user.nome} ha eliminato l'intera mappa ${mappaPrincipale}`);
        }
        res.sendStatus(200);
    } catch (err) {
        console.error("Errore eliminazione mappa:", err);
        res.sendStatus(500);
    }
});

// --- LOGICA DI STATO E PERMESSI ---
let statoMappa = { sfondo: 'mappe/avvio.png', squadre: {}, poi: {}, disegni: null, grigliaAttiva: false };
let ufficialiOnline = 0;
let operatoriAutorizzati = {};
let richiestePendenti = {};

function logEvento(msg) { io.emit('nuovo_log', `[${new Date().toLocaleTimeString()}] ${msg}`); }

io.on('connection', (socket) => {
    const user = socket.request.session?.passport?.user;

    if (!user) return;
    const isUff = ['admin', 'responsabile'].includes(user.ruolo);

    if (isUff) {
        ufficialiOnline++;
        if (Object.keys(operatoriAutorizzati).length > 0) {
            operatoriAutorizzati = {};
            io.emit('comando_revocato');
            io.emit('aggiorna_autorizzati', operatoriAutorizzati);
            logEvento(`[SISTEMA] Ufficiale ${user.nome} online. Comandi operatori revocati.`);
        }
    }

    logEvento(`[CONNESSIONE] ${user.nome} (${user.ruolo}) collegato.`);
    socket.emit('stato_iniziale', statoMappa);

    const haPermessi = () => {
        return isUff || operatoriAutorizzati[socket.id];
    };

    socket.on('richiedi_comando_iniziale', () => {
        if (isUff) {
            socket.emit('comando_concesso');
        } else if (ufficialiOnline === 0) {
            operatoriAutorizzati[socket.id] = user.nome;
            socket.emit('comando_concesso');
            io.emit('aggiorna_autorizzati', operatoriAutorizzati);
            logEvento(`[SISTEMA] ${user.nome} assume il comando tattico (Nessun Ufficiale Online).`);
        } else {
            socket.emit('comando_revocato');
        }
    });

    socket.on('richiedi_comando', () => {
        if (isUff) return;
        if (ufficialiOnline === 0) {
            operatoriAutorizzati[socket.id] = user.nome;
            socket.emit('comando_concesso');
            io.emit('aggiorna_autorizzati', operatoriAutorizzati);
            logEvento(`[SISTEMA] ${user.nome} ha preso il comando.`);
        } else {
            richiestePendenti[socket.id] = user.nome;
            io.emit('aggiorna_richieste', richiestePendenti);
            logEvento(`[RICHIESTA] L'operatore ${user.nome} chiede autorizzazione.`);
        }
    });

    socket.on('approva_richiesta', (id) => {
        if (!isUff) return;
        if (richiestePendenti[id]) {
            operatoriAutorizzati[id] = richiestePendenti[id];
            delete richiestePendenti[id];
            io.to(id).emit('comando_concesso');
            io.emit('aggiorna_autorizzati', operatoriAutorizzati);
            io.emit('aggiorna_richieste', richiestePendenti);
            logEvento(`[SISTEMA] Autorizzazione concessa a ${operatoriAutorizzati[id]} da ${user.nome}.`);
        }
    });

    socket.on('revoca_comando', (id) => {
        if (!isUff) return;
        const nome = operatoriAutorizzati[id];
        delete operatoriAutorizzati[id];
        io.to(id).emit('comando_revocato');
        io.emit('aggiorna_autorizzati', operatoriAutorizzati);
        logEvento(`[SISTEMA] Autorizzazione revocata a ${nome}.`);
    });

    socket.on('rilascia_comando', () => {
        delete operatoriAutorizzati[socket.id];
        socket.emit('comando_revocato');
        io.emit('aggiorna_autorizzati', operatoriAutorizzati);
        logEvento(`[SISTEMA] ${user.nome} ha rilasciato il comando.`);
    });

    socket.on('toggle_griglia_globale', (stato) => {
        if (!haPermessi()) return;
        statoMappa.grigliaAttiva = stato;
        io.emit('cambio_griglia_globale', stato);
    });

    socket.on('salva_disegni', (disegni) => {
        if (!haPermessi()) return;
        statoMappa.disegni = disegni;
        socket.broadcast.emit('aggiorna_disegni', disegni);
    });

    socket.on('pulisci_lavagna', () => {
        if (!haPermessi()) return;
        statoMappa.disegni = null;
        io.emit('aggiorna_disegni', null);
        logEvento(`[MAPPA] Disegni cancellati da ${user.nome}.`);
    });

    socket.on('nuke_mappa', () => {
        const canNuke = isUff || (operatoriAutorizzati[socket.id] && ufficialiOnline === 0);
        if (!canNuke) return;

        statoMappa.squadre = {}; statoMappa.poi = {}; statoMappa.disegni = null;
        io.emit('stato_iniziale', statoMappa);
        logEvento(`[SISTEMA] Mappa resettata completamente da ${user.nome}.`);
    });

    socket.on('nuovo_elemento', (dati) => {
        if (!haPermessi()) return;
        if (dati.tipo === 'squadra') statoMappa.squadre[dati.id] = dati; else statoMappa.poi[dati.id] = dati;
        socket.broadcast.emit('elemento_creato', dati);
        logEvento(`[SCHIERAMENTO] ${user.nome} ha schierato: ${dati.nome || dati.tipo}`);
    });

    socket.on('aggiorna_posizione', (dati) => {
        if (!haPermessi()) return;
        const target = dati.tipo === 'squadra' ? statoMappa.squadre[dati.id] : statoMappa.poi[dati.id];
        if (target) { target.lat = dati.lat; target.lng = dati.lng; }
        socket.broadcast.emit('posizione_aggiornata', dati);
    });

    socket.on('toggle_cerchio_tattico', (dati) => {
        if (!haPermessi()) return;
        const target = dati.tipo === 'squadra' ? statoMappa.squadre[dati.id] : statoMappa.poi[dati.id];
        if (target) target.cerchioAttivo = dati.stato;
        socket.broadcast.emit('aggiorna_cerchio', dati);
    });

    socket.on('aggiorna_roster', (dati) => {
        if (!haPermessi()) return;
        if (statoMappa.squadre[dati.id]) {
            statoMappa.squadre[dati.id].roster = dati.roster;
            socket.broadcast.emit('roster_aggiornato', dati);
        }
    });

    socket.on('elimina_elemento', (dati) => {
        if (!haPermessi()) return;
        if (dati.tipo === 'squadra') delete statoMappa.squadre[dati.id]; else delete statoMappa.poi[dati.id];
        io.emit('elemento_eliminato', dati);
        logEvento(`[RIMOZIONE] Elemento rimosso da ${user.nome}.`);
    });

    socket.on('invia_ping', (dati) => {
        io.emit('ricevi_ping', { ...dati, utente: user.nome, ruolo: user.ruolo });
    });

    socket.on('richiedi_cambio_mappa', (url) => {
        if (!haPermessi()) return;
        statoMappa.sfondo = url;
        io.emit('cambio_mappa', url);
        logEvento(`[MAPPA] ${user.nome} ha cambiato la mappa in visualizzazione.`);
    });

    socket.on('carica_snapshot', (snap) => {
        if (!isUff) return;
        statoMappa = snap;
        io.emit('stato_iniziale', snap);
        logEvento(`[SISTEMA] Missione caricata da ${user.nome}.`);
    });

    socket.on('disconnect', () => {
        logEvento(`[DISCONNESSIONE] ${user.nome} disconnesso.`);

        if (isUff) {
            ufficialiOnline--;
            if (ufficialiOnline <= 0) {
                ufficialiOnline = 0;
                io.emit('comandi_liberati');
                logEvento(`[SISTEMA] Ultimo Ufficiale disconnesso. Comandi sbloccati.`);
            }
        }

        delete operatoriAutorizzati[socket.id];
        delete richiestePendenti[socket.id];
        io.emit('aggiorna_autorizzati', operatoriAutorizzati);
        io.emit('aggiorna_richieste', richiestePendenti);
    });
});

server.listen(PORT, () => console.log(`C2 Server online sulla porta ${PORT}`));