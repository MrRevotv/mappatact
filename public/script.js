window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); }, { passive: false });

let user, socket, map, livelloSfondo;
let isUfficiale = false;
let possiedoComando = false;
const bounds = [[0, 0], [1080, 1920]];

let baseZoom = 0;

let markerSquadre = {}; let markerPOI = {}; let datiSquadre = {};
let elementiSelezionati = []; let dragOffsets = {};
let drawItems = new L.FeatureGroup(); let archivioMappe = [];

let grigliaLayer = L.layerGroup(); let grigliaAttiva = false;
let isDrawingFreehand = false; let freehandCoords = [];
let freehandPolyline = null;
let pingsAttivi = {};
let audioCtx = null;

async function startC2() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            user = await res.json();
            isUfficiale = ['admin', 'responsabile'].includes(user.ruolo);

            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('pannello').style.display = 'flex';
            document.getElementById('sidebar').style.display = 'block';

            socket = io();
            initMap();
            setupSocket();

            socket.emit('richiedi_comando_iniziale');
            caricaListaMappe();
        }
    } catch (e) { console.error("Errore autenticazione:", e); }
}

function initMap() {
    // 1. Inizializza senza bottoni
    map = L.map('map', { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomControl: false, doubleClickZoom: false, attributionControl: false });


    map.fitBounds(bounds);
    baseZoom = map.getZoom();
    map.setMinZoom(baseZoom); // 2. Impedisce di zoomare indietro (rimpicciolire) oltre la grandezza base

    livelloSfondo = L.imageOverlay('mappe/avvio.png', bounds).addTo(map).bringToBack();
    map.addLayer(drawItems);
    map.on('mousedown', (e) => {
        isMousePremutoGomma = true; // Segnala click per gomma
        if (!matitaAttiva || (e.originalEvent && e.originalEvent.pointerType === 'touch')) return;
        iniziaDisegno(e.latlng);
    });
    map.on('mousemove', (e) => {
        if (!matitaAttiva || !isDrawingFreehand || (e.originalEvent && e.originalEvent.pointerType === 'touch')) return;
        continuaDisegno(e.latlng);
    });
    map.on('mouseup', () => {
        isMousePremutoGomma = false; // Rilascia click gomma
        if (isDrawingFreehand) fineDisegno();
    });

    const mapDiv = document.getElementById('map');

    mapDiv.addEventListener('touchstart', (e) => {
        if (!matitaAttiva) return;
        if (e.touches.length === 1) {
            const latlng = map.mouseEventToLatLng(e.touches[0]);
            iniziaDisegno(latlng);
        }
    }, { passive: false });

    mapDiv.addEventListener('touchmove', (e) => {
        if (!matitaAttiva) return;
        e.preventDefault();
        if (isDrawingFreehand && e.touches.length === 1) {
            const latlng = map.mouseEventToLatLng(e.touches[0]);
            continuaDisegno(latlng);
        }
    }, { passive: false });

    mapDiv.addEventListener('touchend', () => {
        if (isDrawingFreehand) fineDisegno();
    }, { passive: false });

    map.on('zoomend', () => {
        if (grigliaAttiva) generaGrigliaTattica();

        let currentZoom = map.getZoom();
        let zoomDiff = currentZoom - baseZoom;
        let factor = Math.pow(1.3, zoomDiff);

        Object.keys(markerSquadre).forEach(id => {
            let mk = markerSquadre[id];
            let ic = mk.getIcon();
            if (ic.options.iconSize) {
                ic.options.iconSize = [40 * factor, 40 * factor];
                ic.options.iconAnchor = [20 * factor, 20 * factor];
                mk.setIcon(ic);
            }
        });
    });

    let touchCount = 0;
    let touchTimer = null;

    map.on('touchstart', function (e) {
        if (matitaAttiva || (typeof gommaAttiva !== 'undefined' && gommaAttiva)) return;

        touchCount++;
        if (touchCount === 1) {
            touchTimer = setTimeout(() => { touchCount = 0; }, 400);
        } else if (touchCount === 2) {
            clearTimeout(touchTimer);
            creaCerchioTattico(e.latlng);
            touchTimer = setTimeout(() => { touchCount = 0; }, 400);
        } else if (touchCount === 3) {
            clearTimeout(touchTimer);
            eseguiSuonoPing(e.latlng.lat, e.latlng.lng, user.ruolo);
            socket.emit('invia_ping', { lat: e.latlng.lat, lng: e.latlng.lng, ruolo: user.ruolo });
            touchCount = 0;
        }
    });

    map.on('click', (e) => {
        if (typeof testoAttivo !== 'undefined' && testoAttivo) {
            let testo = prompt("Inserisci il testo da posizionare:");
            if (testo && testo.trim() !== "") {
                let color = typeof coloreMatita !== 'undefined' ? coloreMatita : '#ffffff';
                let textMarker = L.marker(e.latlng, {
                    icon: L.divIcon({
                        className: 'etichetta-testo-libero',
                        html: `<div style="color: ${color}; font-weight: bold; font-size: 18px; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;">${testo}</div>`,
                        iconSize: [200, 30],
                        iconAnchor: [100, 15]
                    }),
                    draggable: possiedoComando // ABILITA TRASCINAMENTO
                }).addTo(drawItems);

                textMarker.feature = textMarker.feature || { type: 'Feature', properties: {} };
                textMarker.feature.properties.isText = true;
                textMarker.feature.properties.testo = testo;
                textMarker.feature.properties.color = color;

                // SALVA LA POSIZIONE SE LO SPOSTI
                textMarker.on('dragend', function () {
                    if (possiedoComando) socket.emit('salva_disegni', drawItems.toGeoJSON());
                });

                if (typeof assegnaEventiDisegno === 'function') assegnaEventiDisegno(textMarker);
                socket.emit('salva_disegni', drawItems.toGeoJSON());
                window.attivaTesto();
            }
        } else if (!matitaAttiva && !(typeof gommaAttiva !== 'undefined' && gommaAttiva)) {
            deselezionaTutti();
        }
    });
}

function creaCerchioTattico(latlng) {
    if (typeof isUfficiale !== 'undefined' && !isUfficiale) return;
    let cerchio = L.circle(latlng, { radius: 100, color: '#ff4444', fillOpacity: 0.2 }).addTo(map);
    cerchio.on('contextmenu', () => { map.removeLayer(cerchio); });
}

function iniziaDisegno(latlng) {
    isDrawingFreehand = true; freehandCoords = [latlng];
    let currentColor = typeof coloreMatita !== 'undefined' ? coloreMatita : '#ff4444';

    freehandPolyline = L.polyline(freehandCoords, { color: currentColor, weight: 4, interactive: true }).addTo(drawItems);

    // Diciamo al server di "ricordarsi" il colore!
    freehandPolyline.feature = freehandPolyline.feature || { type: 'Feature', properties: {} };
    freehandPolyline.feature.properties.color = currentColor;

    if (typeof assegnaEventiDisegno === 'function') assegnaEventiDisegno(freehandPolyline);
}
function continuaDisegno(latlng) {
    if (isDrawingFreehand) {
        freehandCoords.push(latlng);
        freehandPolyline.setLatLngs(freehandCoords);
    }
}
function fineDisegno() {
    if (isDrawingFreehand) { isDrawingFreehand = false; socket.emit('salva_disegni', drawItems.toGeoJSON()); }
}

window.toggleMatita = () => {
    if (!possiedoComando) return;
    matitaAttiva = !matitaAttiva;
    const btn = document.getElementById('btn-matita');

    if (matitaAttiva) {
        if (gommaAttiva) window.toggleGomma();   // Spegne la gomma se è accesa
        if (testoAttivo) window.attivaTesto();   // Spegne il testo se è acceso
        map.dragging.disable();
        map.touchZoom.disable();
        if (map.tap) map.tap.disable();

        document.getElementById('map').style.cursor = 'crosshair';
        document.getElementById('map').classList.add('drawing-active');
        document.getElementById('map').style.touchAction = 'none';
        document.getElementById('btn-matita').classList.add('attiva');
        //btn.style.background = '#daa520';
        //btn.style.color = 'black';
    } else {
        map.dragging.enable();
        map.touchZoom.enable();
        if (map.tap) map.tap.enable();
        document.getElementById('btn-matita').classList.remove('attiva');
        document.getElementById('map').style.cursor = '';
        document.getElementById('map').classList.remove('drawing-active');
        document.getElementById('map').style.touchAction = '';

        btn.style.background = '#333';
        btn.style.color = 'white';
    }
};

window.undoDisegno = () => {
    if (!possiedoComando) return; const layers = drawItems.getLayers();
    if (layers.length > 0) { drawItems.removeLayer(layers[layers.length - 1]); socket.emit('salva_disegni', drawItems.toGeoJSON()); }
};
window.pulisciDisegni = () => {
    if (!possiedoComando) return;
    if (confirm("Cancellare tutti i disegni a mano?")) { drawItems.clearLayers(); socket.emit('pulisci_lavagna'); }
};
window.toggleGriglia = () => { if (!possiedoComando) return; socket.emit('toggle_griglia_globale', !grigliaAttiva); };

function generaGrigliaTattica() {
    grigliaLayer.clearLayers();
    const SETTORI_X = 10;
    const SETTORI_Y = 6;
    const L_X = 1920 / SETTORI_X;
    const L_Y = 1080 / SETTORI_Y;

    for (let x = 0; x <= 1920; x += L_X) { L.polyline([[0, x], [1080, x]], { color: 'rgba(255,255,255,0.4)', weight: 2, interactive: false }).addTo(grigliaLayer); }
    for (let y = 0; y <= 1080; y += L_Y) { L.polyline([[y, 0], [y, 1920]], { color: 'rgba(255,255,255,0.4)', weight: 2, interactive: false }).addTo(grigliaLayer); }

    const mostraDettagli = map.getZoom() >= (baseZoom + 1.5);

    if (mostraDettagli) {
        for (let x = 0; x <= 1920; x += L_X / 2) { L.polyline([[0, x], [1080, x]], { color: 'rgba(255,255,255,0.15)', weight: 1, dashArray: '5, 5', interactive: false }).addTo(grigliaLayer); }
        for (let y = 0; y <= 1080; y += L_Y / 2) { L.polyline([[y, 0], [y, 1920]], { color: 'rgba(255,255,255,0.15)', weight: 1, dashArray: '5, 5', interactive: false }).addTo(grigliaLayer); }
    }

    for (let r = 0; r < SETTORI_Y; r++) {
        for (let c = 0; c < SETTORI_X; c++) {
            const x0 = c * L_X;
            const y0 = r * L_Y;
            const lettera = String.fromCharCode(65 + (SETTORI_Y - 1 - r));

            L.marker([y0 + L_Y / 2, x0 + L_X / 2], {
                icon: L.divIcon({ html: lettera + (c + 1), className: 'etichetta-coordinata', iconSize: [40, 20] }), interactive: false
            }).addTo(grigliaLayer);

            if (mostraDettagli) {
                const subs = [
                    { n: "1", pos: [y0 + (L_Y * 0.75), x0 + (L_X * 0.25)] },
                    { n: "2", pos: [y0 + (L_Y * 0.75), x0 + (L_X * 0.75)] },
                    { n: "3", pos: [y0 + (L_Y * 0.25), x0 + (L_X * 0.25)] },
                    { n: "4", pos: [y0 + (L_Y * 0.25), x0 + (L_X * 0.75)] }
                ];
                subs.forEach(s => {
                    L.marker(s.pos, {
                        icon: L.divIcon({ html: s.n, className: 'etichetta-coordinata-sub', iconSize: [20, 20] }), interactive: false
                    }).addTo(grigliaLayer);
                });
            }
        }
    }
}

function setupSocket() {
    socket.on('nuovo_log', (msg) => {
        const t = document.getElementById('terminal');
        t.innerHTML += `<div>${msg}</div>`;
        t.scrollTop = t.scrollHeight;
    });

    socket.on('comandi_liberati', () => {
        if (!isUfficiale) {
            socket.emit('richiedi_comando_iniziale');
            MostraNotifica("Ufficiale disconnesso: Comandi mappa sbloccati.");
        }
    });

    socket.on('comando_concesso', () => { possiedoComando = true; aggiornaPannelloPermessi(); MostraNotifica("Permessi di Comando Acquisiti"); });
    socket.on('comando_revocato', () => {
        if (isUfficiale) return;
        possiedoComando = false;
        aggiornaPannelloPermessi();
        const btnRichiedi = document.getElementById('btn-richiedi');
        if (btnRichiedi) btnRichiedi.innerText = "Richiedi Comando";
        MostraNotifica("⚠️ Comando revocato: un Ufficiale è entrato online.");
    });

    socket.on('suono_richiesta_comando', () => {
        if (isUfficiale && audioCtx) {
            try {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime);
                gain.gain.setValueAtTime(0, audioCtx.currentTime);
                gain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.05);
                gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
                osc.start(audioCtx.currentTime);
                osc.stop(audioCtx.currentTime + 0.5);
            } catch (e) { }
        }
    });

    socket.on('aggiorna_richieste', (r) => { if (!isUfficiale) return; const t = document.getElementById('tendinaRichieste'); t.innerHTML = '<option value="">-- Richieste --</option>'; for (let id in r) t.innerHTML += `<option value="${id}">${r[id]}</option>`; });
    socket.on('aggiorna_autorizzati', (r) => { if (!isUfficiale) return; const t = document.getElementById('tendinaAutorizzati'); t.innerHTML = '<option value="">-- Operatori attivi --</option>'; for (let id in r) t.innerHTML += `<option value="${id}">${r[id]}</option>`; });
    socket.on('cambio_griglia_globale', (stato) => { grigliaAttiva = stato; if (stato) { generaGrigliaTattica(); map.addLayer(grigliaLayer); } else { map.removeLayer(grigliaLayer); } });

    const opzioniRenderingDisegni = {
        pointToLayer: function (feature, latlng) {
            if (feature.properties && feature.properties.isText) {
                let m = L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'etichetta-testo-libero',
                        html: `<div style="color: ${feature.properties.color || '#ffffff'}; font-weight: bold; font-size: 18px; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;">${feature.properties.testo}</div>`,
                        iconSize: [200, 30], iconAnchor: [100, 15]
                    }),
                    draggable: typeof possiedoComando !== 'undefined' ? possiedoComando : false
                });

                // SALVA LA POSIZIONE QUANDO LO TRASCINA CHIUNQUE SI CONNETTA
                m.on('dragend', function () {
                    if (possiedoComando) socket.emit('salva_disegni', drawItems.toGeoJSON());
                });

                return m;
            }
            return L.marker(latlng);
        },
        style: function (feature) {
            return { color: feature.properties.color || '#ff4444', weight: 4 };
        },
        onEachFeature: (f, l) => {
            drawItems.addLayer(l);
            if (typeof assegnaEventiDisegno === 'function') assegnaEventiDisegno(l);
        }
    };

    socket.on('aggiorna_disegni', (disegni) => {
        drawItems.clearLayers();
        if (disegni) L.geoJSON(disegni, opzioniRenderingDisegni);
    });

    socket.on('stato_iniziale', (stato) => {
        if (map.hasLayer(livelloSfondo)) map.removeLayer(livelloSfondo);
        livelloSfondo = L.imageOverlay(stato.sfondo + '?t=' + Date.now(), bounds).addTo(map).bringToBack();
        if (stato.grigliaAttiva) { grigliaAttiva = true; generaGrigliaTattica(); map.addLayer(grigliaLayer); }

        for (let id in markerSquadre) map.removeLayer(markerSquadre[id]);
        for (let id in markerPOI) map.removeLayer(markerPOI[id]);
        markerSquadre = {}; markerPOI = {}; datiSquadre = {}; drawItems.clearLayers();

        if (stato.disegni) L.geoJSON(stato.disegni, opzioniRenderingDisegni);

        for (let id in stato.squadre) { creaMarker(stato.squadre[id]); if (stato.squadre[id].cerchioAttivo) aggiornaCerchioMarker(id, 'squadra', true); }
        for (let id in stato.poi) { creaMarker(stato.poi[id]); if (stato.poi[id].cerchioAttivo) aggiornaCerchioMarker(id, 'poi', true); }
        aggiornaSidebar();
    });

    socket.on('cambio_mappa', (url) => { if (map.hasLayer(livelloSfondo)) map.removeLayer(livelloSfondo); livelloSfondo = L.imageOverlay(url + '?t=' + Date.now(), bounds).addTo(map).bringToBack(); });
    socket.on('elemento_creato', (dati) => creaMarker(dati));
    socket.on('posizione_aggiornata', (dati) => { const m = dati.tipo === 'squadra' ? markerSquadre[dati.id] : markerPOI[dati.id]; if (m) m.setLatLng([dati.lat, dati.lng]); });
    socket.on('aggiorna_cerchio', (dati) => { if (dati.tipo === 'squadra' && datiSquadre[dati.id]) datiSquadre[dati.id].cerchioAttivo = dati.stato; aggiornaCerchioMarker(dati.id, dati.tipo, dati.stato); });
    socket.on('roster_aggiornato', (dati) => { if (datiSquadre[dati.id]) { datiSquadre[dati.id].roster = dati.roster; aggiornaSidebar(); } });
    socket.on('elemento_eliminato', (dati) => { if (dati.tipo === 'squadra' && markerSquadre[dati.id]) { map.removeLayer(markerSquadre[dati.id]); delete markerSquadre[dati.id]; delete datiSquadre[dati.id]; aggiornaSidebar(); } else if (markerPOI[dati.id]) { map.removeLayer(markerPOI[dati.id]); delete markerPOI[dati.id]; } });
    socket.on('ricevi_ping', (dati) => eseguiSuonoPing(dati.lat, dati.lng, dati.ruolo));
}

function creaMarker(dati) {
    if (markerSquadre[dati.id] || markerPOI[dati.id]) return;
    if (!dati.hasOwnProperty('cerchioAttivo')) dati.cerchioAttivo = false;

    // Supporto retrocompatibile: se non ha icona ma ha percorsoIcona, o viceversa
    let path = dati.icona || dati.percorsoIcona || 'fps';

    const html = `<div class="contenitore-icona"><img src="${path.startsWith('Icone') ? '' : 'icone/'}${path}.png" class="immagine-custom" onerror="this.src='icone/fps.png'">${dati.tipo === 'squadra' ? `<div class="etichetta-nome">${dati.nome}</div>` : ''}</div>`;

    // Mantieni le proporzioni scalate dello zoom attuale se esiste già
    let currentFactor = 1;
    if (map && baseZoom) {
        currentFactor = Math.pow(1.3, map.getZoom() - baseZoom);
    }

    const icon = L.divIcon({ html: html, className: 'wrapper-icona', iconSize: [40 * currentFactor, 40 * currentFactor], iconAnchor: [20 * currentFactor, 20 * currentFactor] });
    const m = L.marker([dati.lat, dati.lng], { icon: icon, draggable: possiedoComando }).addTo(map);

    if (dati.tipo === 'squadra') {
        markerSquadre[dati.id] = m; datiSquadre[dati.id] = dati; aggiornaSidebar();
        const popupContent = `
            <div class="squadra-popup">
                <h3>Opzioni Squadra</h3>
                ${generaMenuIcona(dati.id, dati)}
                <hr>
                <label>Capo:</label><input id="c_${dati.id}" oninput="salvaRoster('${dati.id}')">
                <label>Vice:</label><input id="v_${dati.id}" oninput="salvaRoster('${dati.id}')">
                <label>Membri:</label><textarea id="m_${dati.id}" oninput="salvaRoster('${dati.id}')"></textarea>
            </div>`;
        m.bindPopup(popupContent);

        m.on('popupopen', () => {
            if (document.getElementById(`c_${dati.id}`)) document.getElementById(`c_${dati.id}`).value = datiSquadre[dati.id].roster.capo || '';
            if (document.getElementById(`v_${dati.id}`)) document.getElementById(`v_${dati.id}`).value = datiSquadre[dati.id].roster.vice || '';
            if (document.getElementById(`m_${dati.id}`)) document.getElementById(`m_${dati.id}`).value = datiSquadre[dati.id].roster.membri || '';
        });
    } else { markerPOI[dati.id] = m; }

    m.on('mousedown', (e) => {
        disattivaMatitaSeAttiva();
        if (e.originalEvent.button === 1) {
            e.originalEvent.preventDefault(); m.closePopup(); toggleSelezione(dati.id, dati.tipo);
        } else if (e.originalEvent.button === 0 && !elementiSelezionati.some(el => el.id === dati.id)) {
            selezionaElementoUnico(dati.id, dati.tipo);
        }
    });
    m.on('contextmenu', (e) => {
        if (!possiedoComando) return; e.originalEvent.preventDefault();
        const nuovoStato = !dati.cerchioAttivo; dati.cerchioAttivo = nuovoStato;
        aggiornaCerchioMarker(dati.id, dati.tipo, nuovoStato);
        socket.emit('toggle_cerchio_tattico', { id: dati.id, tipo: dati.tipo, stato: nuovoStato });
    });
    m.on('dragstart', () => { disattivaMatitaSeAttiva(); dragOffsets = {}; if (elementiSelezionati.some(el => el.id === dati.id)) { elementiSelezionati.forEach(el => { const trgt = el.tipo === 'squadra' ? markerSquadre[el.id] : markerPOI[el.id]; dragOffsets[el.id] = { dLat: trgt.getLatLng().lat - m.getLatLng().lat, dLng: trgt.getLatLng().lng - m.getLatLng().lng }; }); } });
    m.on('drag', () => { if (elementiSelezionati.some(el => el.id === dati.id)) { elementiSelezionati.forEach(el => { if (el.id !== dati.id) { const trgt = el.tipo === 'squadra' ? markerSquadre[el.id] : markerPOI[el.id]; trgt.setLatLng([m.getLatLng().lat + dragOffsets[el.id].dLat, m.getLatLng().lng + dragOffsets[el.id].dLng]); } }); } });
    m.on('dragend', () => { if (elementiSelezionati.some(el => el.id === dati.id)) { elementiSelezionati.forEach(el => { const trgt = el.tipo === 'squadra' ? markerSquadre[el.id] : markerPOI[el.id]; socket.emit('aggiorna_posizione', { id: el.id, tipo: el.tipo, lat: trgt.getLatLng().lat, lng: trgt.getLatLng().lng }); }); } else { socket.emit('aggiorna_posizione', { id: dati.id, tipo: dati.tipo, lat: m.getLatLng().lat, lng: m.getLatLng().lng }); } });
}

window.aggiornaCerchioMarker = (id, tipo, stato) => {
    const m = tipo === 'squadra' ? markerSquadre[id] : markerPOI[id];
    if (!m) return;
    const container = m.getElement().querySelector('.contenitore-icona');
    let cerchio = container.querySelector('.cerchio-tattico');
    if (stato) {
        if (!cerchio) {
            cerchio = document.createElement('div'); cerchio.className = 'cerchio-tattico';
            container.appendChild(cerchio);
        }
    }
    else { if (cerchio) cerchio.remove(); }
};

window.creaElemento = (icona, tipo) => {
    disattivaMatitaSeAttiva();
    if (!possiedoComando) return;
    const center = map.getCenter();
    const id = tipo + '_' + Date.now();

    // Fix: assicura che il campo icona e percorsoIcona siano settati bene
    const dati = {
        id: id, tipo: tipo, lat: center.lat, lng: center.lng, icona: icona, percorsoIcona: icona, cerchioAttivo: false, nome: tipo === 'squadra' ?
            prompt("Nome Squadra:") : '', roster: { capo: '', vice: '', membri: '' }
    };
    if (tipo === 'squadra' && !dati.nome) return;
    creaMarker(dati); socket.emit('nuovo_elemento', dati);
};

// Questo è il ponte tra icone_db.js e script.js (viene chiamato quando clicchi il bottone nel pannello)
window.aggiungiIcona = (lat, lng, percorso, nome, isSquadra) => {
    window.creaElemento(percorso.replace('.png', ''), isSquadra ? 'squadra' : 'poi');
};

window.salvaRoster = (id) => {
    if (!possiedoComando) return;
    datiSquadre[id].roster.capo = document.getElementById(`c_${id}`).value;
    datiSquadre[id].roster.vice = document.getElementById(`v_${id}`).value;
    datiSquadre[id].roster.membri = document.getElementById(`m_${id}`).value;
    socket.emit('aggiorna_roster', { id: id, roster: datiSquadre[id].roster });
    aggiornaSidebar();
};

function aggiornaSidebar() {
    const cont = document.getElementById('lista-squadre');
    if (!cont) return;
    let html = '';
    for (let id in datiSquadre) {
        const sq = datiSquadre[id];
        html += `<div class="scheda-squadra" onclick="selezionaElementoUnico('${id}', 'squadra', true)">
                <h4>${sq.nome}</h4>
                <div class="roster-info"><span><b>C:</b> ${sq.roster.capo ||
            '-'}</span> | <span><b>V:</b> ${sq.roster.vice || '-'}</span></div>
                <div class="roster-membri">${sq.roster.membri ?
                sq.roster.membri.replace(/\n/g, ', ') : ''}</div>
            </div>`;
    }
    cont.innerHTML = html || '<i>Nessuna forza schierata.</i>';
}

function toggleSelezione(id, tipo) {
    const m = tipo === 'squadra' ? markerSquadre[id] : markerPOI[id];
    const index = elementiSelezionati.findIndex(el => el.id === id);
    if (index !== -1) {
        elementiSelezionati.splice(index, 1); m.getElement().querySelector('.contenitore-icona').classList.remove('squadra-selezionata');
    }
    else { elementiSelezionati.push({ id, tipo }); m.getElement().querySelector('.contenitore-icona').classList.add('squadra-selezionata'); }
}
window.selezionaElementoUnico = (id, tipo, pan) => {
    deselezionaTutti();
    const m = tipo === 'squadra' ? markerSquadre[id] : markerPOI[id]; if (!m) return; elementiSelezionati = [{ id: id, tipo: tipo }]; m.getElement().querySelector('.contenitore-icona').classList.add('squadra-selezionata');
    if (pan) map.panTo(m.getLatLng());
};
window.deselezionaTutti = () => { elementiSelezionati = []; document.querySelectorAll('.contenitore-icona').forEach(el => el.classList.remove('squadra-selezionata')); };
window.eliminaSelezionati = () => {
    if (!possiedoComando || elementiSelezionati.length === 0) return; if (confirm(`Eliminare ${elementiSelezionati.length} elementi?`)) {
        elementiSelezionati.forEach(el => socket.emit('elimina_elemento', el)); deselezionaTutti();
    }
};

window.nukeMappa = () => {
    if (!possiedoComando) return;
    if (confirm("⚠️ ATTENZIONE ⚠️\nSei sicuro di voler eliminare TUTTE le forze, i bersagli e i disegni dalla mappa?")) {
        socket.emit('nuke_mappa');
        deselezionaTutti();
    }
}

function eseguiSuonoPing(lat, lng, ruoloMittente) {
    let colore = '#44ff44';
    if (ruoloMittente === 'admin') colore = '#ff4444';
    else if (ruoloMittente === 'responsabile') colore = '#4444ff';

    if (pingsAttivi[ruoloMittente]) {
        map.removeLayer(pingsAttivi[ruoloMittente].marker);
        clearTimeout(pingsAttivi[ruoloMittente].timer);
    }

    const icon = L.divIcon({ html: `<div class="ping-animato" style="border-color: ${colore}; box-shadow: 0 0 15px ${colore}, inset 0 0 15px ${colore};"></div>`, className: '', iconSize: [40, 40], iconAnchor: [20, 20] });
    const p = L.marker([lat, lng], { icon: icon, interactive: false }).addTo(map);

    const timer = setTimeout(() => {
        map.removeLayer(p);
        delete pingsAttivi[ruoloMittente];
    }, 10000);

    pingsAttivi[ruoloMittente] = { marker: p, timer: timer };

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(700, ctx.currentTime + i);
            gain.gain.setValueAtTime(0, ctx.currentTime + i);
            gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i + 0.1);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i + 0.8);
            osc.start(ctx.currentTime + i); osc.stop(ctx.currentTime + i + 1);
        }
    } catch (e) { }
}

window.resetZoom = () => map.fitBounds(bounds);
window.richiediComando = () => { socket.emit('richiedi_comando'); document.getElementById('btn-richiedi').innerText = "⏳ In attesa..."; };
window.rilasciaComando = () => socket.emit('rilascia_comando');
window.approvaRichiesta = () => { const v = document.getElementById('tendinaRichieste').value; if (v) socket.emit('approva_richiesta', v); };
window.revocaSingolo = () => { const v = document.getElementById('tendinaAutorizzati').value; if (v) socket.emit('revoca_comando', v); };
window.resetMap = function () {
    if (map && bounds) {
        map.fitBounds(bounds);
        let currentZoom = map.getZoom();
        map.setMinZoom(currentZoom); // Blocca lo zoom out alla grandezza attuale
    }
};

// --- FIX PANNELLI ---

// Funzione universale per aggiornare la mappa dopo che i pannelli si sono mossi
function aggiornaMappa() {
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 450); // Aspetta che finisca l'animazione CSS (0.4s)
}

window.togglePannello = () => {
    document.getElementById('pannello').classList.toggle('nascosto');
    aggiornaMappa();
};

window.toggleRoster = () => {
    document.getElementById('sidebar').classList.toggle('nascosto');
    aggiornaMappa();
};

window.toggleOrbita = () => {
    document.getElementById('sidebar-orbita').classList.toggle('nascosto');
    aggiornaMappa();
};

// Pezzo fondamentale per il cambio monitor / ridimensionamento finestra
window.addEventListener('resize', () => {
    if (map) {
        map.invalidateSize();
        map.fitBounds(bounds); // Ricentra la mappa per adattarla al nuovo schermo
    }
});

window.toggleConsole = () => {
    document.getElementById('terminal-wrapper').classList.toggle('nascosto');
    // Questa funzione (se l'hai aggiunta prima) serve a far adattare la mappa
    if (typeof aggiornaMappa === 'function') aggiornaMappa();
};

function aggiornaPannelloPermessi() {
    if (document.getElementById('overlay-operatore')) document.getElementById('overlay-operatore').style.display = (!isUfficiale && !possiedoComando) ? 'flex' : 'none';
    if (document.getElementById('pannello-admin')) document.getElementById('pannello-admin').style.display = isUfficiale ? 'block' : 'none';
    aggiornaInterazioneMappa();
}

function aggiornaInterazioneMappa() {
    for (let id in markerSquadre) { if (possiedoComando) markerSquadre[id].dragging.enable(); else markerSquadre[id].dragging.disable(); }
    for (let id in markerPOI) { if (possiedoComando) markerPOI[id].dragging.enable(); else markerPOI[id].dragging.disable(); }

    // Attiva/Disattiva il trascinamento dei testi
    if (typeof drawItems !== 'undefined') {
        drawItems.eachLayer(layer => {
            if (layer.dragging && layer.options.icon && layer.options.icon.options.className === 'etichetta-testo-libero') {
                if (possiedoComando) layer.dragging.enable(); else layer.dragging.disable();
            }
        });
    }
}

function MostraNotifica(testo) {
    const b = document.getElementById('banner-notifiche');
    b.innerText = testo; b.style.top = "0";
    setTimeout(() => b.style.top = "-50px", 4000);
}

function disattivaMatitaSeAttiva() { if (matitaAttiva) window.toggleMatita(); }

// --- NUOVA GESTIONE MAPPE ---
let mappeData = { master: [], submaps: {} };

async function caricaListaMappe() {
    try {
        const gioco = document.getElementById('filtro-gioco').value;
        const sistema = document.getElementById('filtro-sistema').value;
        const res = await fetch(`/api/lista-mappe?gioco=${gioco}&sistema=${sistema}`);
        mappeData = await res.json(); renderizzaTendinaMappe();
    } catch (e) { }
}

window.renderizzaTendinaMappe = () => {
    const t = document.getElementById('tendinaMappe');
    if (!t) return;
    t.innerHTML = '<option value="">-- Scegli mappa master --</option>';

    mappeData.master.forEach(m => {
        t.innerHTML += `<option value="${m.nomeDir}" data-file="${m.file}">${m.nomeDir}</option>`;
    });
};

window.cambiaMappaPrincipale = () => {
    if (!possiedoComando) return;
    const t = document.getElementById('tendinaMappe');
    const dir = t.value;
    if (!dir) return;

    // Estrapola il file master
    const opt = t.options[t.selectedIndex];
    const file = opt.getAttribute('data-file');

    const gioco = document.getElementById('filtro-gioco').value;
    const sistema = document.getElementById('filtro-sistema').value;
    const basePath = gioco === 'sc' ? `Star Citizen/${sistema}` : (gioco === 'arma' ? 'Arma' : 'General');

    socket.emit('richiedi_cambio_mappa', `Mappe/${basePath}/${dir}/mappa_master/${file}`);

    // Popola tendina sottomappe, ma la lascia sempre visibile
    const td = document.getElementById('tendinaDettagli');
    td.innerHTML = '<option value="">-- Carica Dettaglio / Sottomappa --</option>';
    if (mappeData.submaps[dir] && mappeData.submaps[dir].length > 0) {
        mappeData.submaps[dir].forEach(sub => { td.innerHTML += `<option value="${sub}">${sub}</option>`; });
    }
};

window.cambiaSottomappa = () => {
    if (!possiedoComando) return;
    const dir = document.getElementById('tendinaMappe').value;
    const sub = document.getElementById('tendinaDettagli').value;

    // Se selezioni "-- Carica Dettaglio --" (vuoto), ti riporta alla mappa Master
    if (!sub && dir) {
        window.cambiaMappaPrincipale();
        return;
    }
    if (!dir || !sub) return;

    const gioco = document.getElementById('filtro-gioco').value;
    const sistema = document.getElementById('filtro-sistema').value;
    const basePath = gioco === 'sc' ? `Star Citizen/${sistema}` : (gioco === 'arma' ? 'Arma' : 'General');

    socket.emit('richiedi_cambio_mappa', `Mappe/${basePath}/${dir}/${sub}`);
};

// Auto-upload e Auto-Show
window.uploadMappa = async (tipo) => {
    const fileInput = tipo === 'master' ? document.getElementById('fileMappaMaster') : document.getElementById('fileSottomappa');
    const file = fileInput.files[0];
    if (!file || !possiedoComando) return;

    const gioco = document.getElementById('filtro-gioco').value;
    const sistema = document.getElementById('filtro-sistema').value;
    let mappaPrincipale = document.getElementById('tendinaMappe').value;

    if (tipo === 'master') {
        mappaPrincipale = file.name.replace(/\.[^/.]+$/, ""); // Il nome cartella diventa il nome file
    } else if (tipo === 'submap' && !mappaPrincipale) {
        alert("Seleziona prima una Mappa Principale dalla tendina in cui inserire il dettaglio!");
        fileInput.value = "";
        return;
    }

    const fd = new FormData();
    fd.append('nuovaMappa', file);
    fd.append('tipo', tipo);
    fd.append('gioco', gioco);
    fd.append('sistema', sistema);
    if (tipo === 'submap') fd.append('mappaPrincipale', mappaPrincipale);

    // Carica fisicamente il file
    await fetch('/upload-mappa', { method: 'POST', body: fd });
    fileInput.value = "";

    // Ricarica l'elenco in background
    await caricaListaMappe();

    // -- AUTOCARICAMENTO A SCHERMO --
    const basePath = gioco === 'sc' ? `Star Citizen/${sistema}` : (gioco === 'arma' ? 'Arma' : 'General');
    const nomeFilePulito = file.name.replace(/\s+/g, '-'); // Mantiene la coerenza coi nomi

    if (tipo === 'master') {
        document.getElementById('tendinaMappe').value = mappaPrincipale;
        cambiaMappaPrincipale(); // Aggiorna anche l'interfaccia
        socket.emit('richiedi_cambio_mappa', `Mappe/${basePath}/${mappaPrincipale}/mappa_master/${nomeFilePulito}`);
    } else {
        document.getElementById('tendinaMappe').value = mappaPrincipale;
        cambiaMappaPrincipale(); // Ripopola i dettagli
        setTimeout(() => { document.getElementById('tendinaDettagli').value = nomeFilePulito; }, 200);
        socket.emit('richiedi_cambio_mappa', `Mappe/${basePath}/${mappaPrincipale}/${nomeFilePulito}`);
    }
};

window.eliminaMappaCorrente = async () => {
    if (!possiedoComando) return;
    const gioco = document.getElementById('filtro-gioco').value;
    const sistema = document.getElementById('filtro-sistema').value;
    const dir = document.getElementById('tendinaMappe').value;
    const sub = document.getElementById('tendinaDettagli').value;

    if (!dir) return;

    // Chiede due conferme diverse in base a cosa sta cancellando
    let messaggio = sub ?
        `Sei sicuro di voler eliminare la sottomappa "${sub}"?` :
        `⚠️ ATTENZIONE: Sei sicuro di voler eliminare l'INTERA MAPPA "${dir}" e tutti i suoi dettagli? L'operazione non è reversibile.`;

    if (confirm(messaggio)) {
        await fetch(`/api/elimina-mappa?gioco=${gioco}&sistema=${sistema}&mappaPrincipale=${dir}&sottomappa=${sub}`, { method: 'DELETE' });

        // Riporta lo schermo al logo di avvio
        socket.emit('richiedi_cambio_mappa', 'mappe/avvio.png');
        await caricaListaMappe();
    }
};

window.saveMission = () => {
    for (let id in markerSquadre) {
        if (datiSquadre[id]) {
            datiSquadre[id].lat = markerSquadre[id].getLatLng().lat;
            datiSquadre[id].lng = markerSquadre[id].getLatLng().lng;
        }
    }
    const data = { sfondo: livelloSfondo._url.split('?')[0], squadre: datiSquadre, poi: {}, disegni: drawItems.toGeoJSON(), grigliaAttiva: grigliaAttiva };
    for (let id in markerPOI) {
        data.poi[id] = { id: id, lat: markerPOI[id].getLatLng().lat, lng: markerPOI[id].getLatLng().lng, icona: markerPOI[id].options.icon.options.html.match(/icone\/(.*)\.png/)[1], tipo: 'poi', cerchioAttivo: markerPOI[id].cerchioAttivo || false };
    }
    const b = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `Missione_${Date.now()}.json`; a.click();
};

window.loadMission = (e) => { const reader = new FileReader(); reader.onload = (ev) => socket.emit('carica_snapshot', JSON.parse(ev.target.result)); reader.readAsText(e.target.files[0]); };

// Gestione Modifiche Interfaccia Icone (Aggiunto salvataggio testo ed estrazione path corretto)
window.generaMenuIcona = (id, dati) => {
    let path = dati.icona || dati.percorsoIcona || "";
    let isGeneral = path.includes('general');

    let html = `
        <input type="text" id="nome-${id}" value="${dati.nome || ''}" placeholder="Nome (es. Alpha)" style="width: 100%; margin-bottom: 5px;">`;

    if (!isGeneral) {
        html += `
        <div style="margin-bottom: 5px; display:flex; gap: 5px; justify-content: space-between;">
            <button class="btn-amica" onclick="cambiaFazione('${id}', 'amica')" style="flex:1;">AMICA</button>
            <button class="btn-nemica" onclick="cambiaFazione('${id}', 'nemica')" style="flex:1;">NEMICA</button>
        </div>`;
    }

    html += `<button onclick="salvaModificheIcona('${id}')" style="width: 100%; background: #44aa44;">Salva Nome</button>`;
    return html;
};

window.salvaModificheIcona = (id) => {
    let dati = datiSquadre[id];
    if (dati) {
        let inputNome = document.getElementById(`nome-${id}`);
        if (inputNome) dati.nome = inputNome.value;
        aggiornaIconaVisiva(id, dati.icona);
        socket.emit('aggiorna_stato_icona', dati);
        aggiornaSidebar();
    }
};

window.cambiaFazione = (id, fazione) => {
    let dati = datiSquadre[id];
    let originalPath = dati.icona || dati.percorsoIcona;

    if (fazione === 'nemica' && !originalPath.includes('-enemy')) {
        dati.icona = originalPath.replace('icone amiche', 'icone nemiche').replace('.png', '').replace(/OP_([A-Z]+)\//, 'OP_$1_ENEMY/') + '-enemy';
    } else if (fazione === 'amica' && originalPath.includes('-enemy')) {
        dati.icona = originalPath.replace('icone nemiche', 'icone amiche').replace('-enemy', '').replace(/OP_([A-Z]+)_ENEMY\//, 'OP_$1/');
    }

    aggiornaIconaVisiva(id, dati.icona);
    socket.emit('aggiorna_stato_icona', dati);
};

window.aggiornaIconaVisiva = (id, nuovoPercorso) => {
    const m = markerSquadre[id];
    if (!m) return;

    // Ricalcola il fattore di zoom
    let currentFactor = 1;
    if (map && baseZoom) currentFactor = Math.pow(1.3, map.getZoom() - baseZoom);

    const html = `<div class="contenitore-icona"><img src="${nuovoPercorso.startsWith('Icone') ? '' : 'icone/'}${nuovoPercorso}.png" class="immagine-custom" onerror="this.src='icone/fps.png'"><div class="etichetta-nome">${datiSquadre[id].nome}</div></div>`;

    m.setIcon(L.divIcon({ html: html, className: 'wrapper-icona', iconSize: [40 * currentFactor, 40 * currentFactor], iconAnchor: [20 * currentFactor, 20 * currentFactor] }));
};

window.salvaPreset = () => {
    if (Object.keys(markerSquadre).length === 0 && Object.keys(markerPOI).length === 0) {
        alert("Errore: Impossibile salvare un preset vuoto. Schiera delle unità o dei POI prima di salvare.");
        return;
    }
    socket.emit('salva_preset', { squadre: datiSquadre, disegni: drawItems.toGeoJSON() });
};

// ==========================================
// SISTEMA DI "PARCHEGGIO" IN ORBITA
// ==========================================
// Controlla ogni 2 secondi se ci sono nuove icone sulla mappa per assegnargli la funzione Orbita
setInterval(() => {
    if (typeof map === 'undefined' || !possiedoComando) return;

    map.eachLayer((layer) => {
        // Cerca i marker (le icone) che possono essere trascinati
        if (layer.dragging && layer.options.icon && !layer.orbitaAttiva) {
            layer.orbitaAttiva = true;

            // Quando molli il tasto del mouse...
            layer.on('dragend', function (e) {
                const orbita = document.getElementById('sidebar-orbita');
                const rect = orbita.getBoundingClientRect();
                const containerP = document.getElementById('orbita-container');

                // Se hai mollato l'icona dentro al riquadro sinistro (Orbita)
                if (!orbita.classList.contains('nascosto') &&
                    e.originalEvent.clientX < rect.right &&
                    e.originalEvent.clientY < rect.bottom) {

                    // 1. Rendiamo il marker invisibile sulla mappa
                    this.setOpacity(0);

                    // 2. Creiamo una "foto" dell'icona da lasciare nel parcheggio
                    let img = document.createElement('img');
                    img.src = this._icon.querySelector('img') ? this._icon.querySelector('img').src : '';
                    img.style.width = '60px';
                    img.style.cursor = 'pointer';
                    img.style.border = '2px solid transparent';
                    img.title = "Clicca per schierare al centro della mappa";

                    // Effetto hover
                    img.onmouseover = () => img.style.border = '2px solid #7289da';
                    img.onmouseout = () => img.style.border = '2px solid transparent';

                    // 3. Se ci clicchi sopra, torna sul campo di battaglia
                    img.onclick = () => {
                        let center = map.getCenter();
                        this.setLatLng(center); // Riporta l'unità vera al centro
                        this.setOpacity(1);     // Rendi di nuovo visibile sulla mappa
                        img.remove();           // Elimina la foto dal parcheggio

                        // Aggiorna server (utilizzando la funzione generale che già hai)
                        if (typeof aggiornaPosizioneElemento === 'function') {
                            aggiornaPosizioneElemento(this);
                        }
                    };

                    containerP.appendChild(img);
                }
            });
        }
    });
}, 2000);

startC2();