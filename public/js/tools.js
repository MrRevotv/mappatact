let gommaAttiva = false;
let matitaAttiva = false;
let testoAttivo = false;
let coloreMatita = "#ff4444";
let isMousePremutoGomma = false;

window.toggleGomma = () => {
    if (!possiedoComando) return;
    gommaAttiva = !gommaAttiva;
    
    if (gommaAttiva) {
        if (matitaAttiva) window.toggleMatita(); // Spegne la matita se è accesa
        if (testoAttivo) window.attivaTesto();   // Spegne il testo se è acceso
        document.getElementById('btn-gomma').classList.add('attiva');
        map.dragging.disable();
        document.getElementById('map').style.cursor = 'help';
    } else {
        document.getElementById('btn-gomma').classList.remove('attiva');
        map.dragging.enable();
        document.getElementById('map').style.cursor = '';
    }
};

window.attivaTesto = () => {
    if (!possiedoComando) return;
    testoAttivo = !testoAttivo;
    
    if (testoAttivo) {
        if (matitaAttiva) window.toggleMatita(); // Spegne la matita
        if (gommaAttiva) window.toggleGomma();   // Spegne la gomma
        //document.getElementById('btn-testo').style.background = '#daa520';
        //document.getElementById('btn-testo').style.color = 'black';
        document.getElementById('btn-testo').classList.add('attiva');
        document.getElementById('map').style.cursor = 'text';
    } else {
        document.getElementById('btn-testo').classList.remove('attiva');
        document.getElementById('map').style.cursor = '';
    }
};

window.cambiaColoreMatita = () => {
    coloreMatita = document.getElementById('colore-matita').value;
};

window.assegnaEventiDisegno = (layer) => {
    layer.on('mousedown', function() {
        if (gommaAttiva && isUfficiale) {
            drawItems.removeLayer(this);
            socket.emit('salva_disegni', drawItems.toGeoJSON());
        }
    });
    layer.on('mouseover', function() {
        if (gommaAttiva && isMousePremutoGomma && isUfficiale) {
            drawItems.removeLayer(this);
            socket.emit('salva_disegni', drawItems.toGeoJSON());
        }
    });
};