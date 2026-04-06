// --- DATABASE DELLE ICONE ---
// Qui definiamo i nomi dei bottoni e i percorsi relativi delle immagini.
const databaseIcone = {
    sc: { // STAR CITIZEN
        basePath: "Icone/icone star citizen/",
        categorie: {
            "Generali": [
                { nome: "Alert", file: "generali/ALERT.png" },
                { nome: "Obiettivo", file: "generali/OBIETTIVO.png" },
                { nome: "Obiettivo VIP", file: "generali/OBIETTIVO_VIP.png" },
                { nome: "POI Mining", file: "generali/POI_MINING.png" },
                { nome: "POI Observe", file: "generali/POI_OBSERVE.png" },
                { nome: "Radioactive", file: "generali/RADIOACTIVE.png" }
            ],
            "OP FPS": [
                { nome: "FPS General", file: "icone amiche/OP_FPS/SQ_FPSgeneral.png" },
                { nome: "FPS Sniper", file: "icone amiche/OP_FPS/SQ_FPSsniper.png" },
                { nome: "Medica", file: "icone amiche/OP_FPS/SQ_MEDICA.png" },
                { nome: "Veicoli", file: "icone amiche/OP_FPS/SQ_VEICOLI.png" }
            ],
            "OP Industriali": [
                { nome: "Commercio", file: "icone amiche/OP_INDUSTRIALI/SQ_COMMERCIO.png" },
                { nome: "Mining", file: "icone amiche/OP_INDUSTRIALI/SQ_MINING.png" },
                { nome: "Salvage", file: "icone amiche/OP_INDUSTRIALI/SQ_SALVAGE.png" },
                { nome: "Carico/Scarico", file: "icone amiche/OP_INDUSTRIALI/SQ_car_scar.png" }
            ],
            "OP Volo": [
                { nome: "Dropship", file: "icone amiche/OP_VOLO/DROPSHIP.png" },
                { nome: "Admiral", file: "icone amiche/OP_VOLO/SQ_ADMIRAL.png" },
                { nome: "Capital", file: "icone amiche/OP_VOLO/SQ_CAPITAL.png" },
                { nome: "Volo", file: "icone amiche/OP_VOLO/SQ_VOLO.png" }
            ],
            "Tattica": [
                { nome: "Antiaerea", file: "icone amiche/TATTICA/ANTIAEREA.png" },
                { nome: "Commando", file: "icone amiche/TATTICA/COMMANDO.png" },
                { nome: "Comms", file: "icone amiche/TATTICA/COMMS.png" },
                { nome: "Destroy", file: "icone amiche/TATTICA/DESTROY.png" },
                { nome: "Esfiltrazione", file: "icone amiche/TATTICA/ESFILTRAZIONE.png" },
                { nome: "Health", file: "icone amiche/TATTICA/HEALTH.png" },
                { nome: "Parcheggio", file: "icone amiche/TATTICA/PARCHEGGIO.png" },
                { nome: "Protect", file: "icone amiche/TATTICA/PROTECT.png" },
                { nome: "Rifornimento", file: "icone amiche/TATTICA/RIFORNIMENTO.png" },
                { nome: "Riparazioni", file: "icone amiche/TATTICA/RIPARAZIONI.png" },
                { nome: "Scudo", file: "icone amiche/TATTICA/SCUDO.png" },
                { nome: "Supply", file: "icone amiche/TATTICA/SUPPLY.png" }
            ]
        }
    },
    arma: { // ARMA
        basePath: "Icone/icone arma/",
        categorie: {
            "Fanteria": [
                // Inserisci qui i file di Arma in futuro
                // { nome: "Fuciliere", file: "fuciliere.png" }
            ]
        }
    },
    general: { // GENERAL (NATO)
        basePath: "Icone/icone general/",
        categorie: {
            "Simboli NATO": [
                // Inserisci qui i file standard in futuro
            ]
        }
    }
};

// --- FUNZIONE PER CAMBIARE IL SET NEL PANNELLO ---
// Questa funzione viene chiamata in automatico dall'HTML quando cambi la tendina "Set Operativo"
window.cambiaSetIcone = () => {
    const giocoSelezionato = document.getElementById('filtro-gioco').value;
    const filtroSistema = document.getElementById('filtro-sistema');
    const container = document.getElementById('icone-container');

    // Svuota il contenitore attuale
    container.innerHTML = '';

    // Mostra la tendina dei sistemi (Stanton, Pyro, ecc) SOLO se è selezionato Star Citizen
    if (giocoSelezionato === 'sc') {
        filtroSistema.style.display = 'block';
    } else {
        filtroSistema.style.display = 'none';
    }

    const setCorrente = databaseIcone[giocoSelezionato];
    if (!setCorrente) return;

    // Genera i bottoni dinamicamente leggendo dal database
    for (const [nomeCategoria, listaIcone] of Object.entries(setCorrente.categorie)) {
        if (listaIcone.length > 0) {

            // Crea il titolo della categoria (es: "OP VOLO")
            let titolo = document.createElement('h4');
            titolo.innerText = nomeCategoria.toUpperCase();
            titolo.style.width = '100%';
            titolo.style.color = '#7289da'; // Colore stile Discord
            titolo.style.marginBottom = '2px';
            titolo.style.marginTop = '10px';
            titolo.style.borderBottom = '1px solid #444';
            container.appendChild(titolo);

            // Crea i bottoni per ogni icona
            listaIcone.forEach(icona => {
                let btn = document.createElement('button');
                btn.className = "btn-icona";
                btn.innerText = icona.nome;
                btn.style.margin = "2px";

                let fullPath = setCorrente.basePath + icona.file;

                // Quando l'utente clicca sul bottone, spawna l'icona
                // (Assicurati che la funzione aggiungiIcona sia definita nel tuo script.js)
                btn.onclick = () => {
                    // Questa è la funzione che già avevi nel tuo script base per posizionare l'icona al centro
                    let center = map.getCenter();
                    aggiungiIcona(center.lat, center.lng, fullPath, icona.nome, true);
                };

                container.appendChild(btn);
            });
        }
    }
};

// Inizializza il menù appena la pagina si carica (ritardo di mezzo secondo per sicurezza)
setTimeout(() => {
    if (document.getElementById('filtro-gioco')) {
        cambiaSetIcone();
    }
}, 500);