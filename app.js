// --- 1. CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyAjkWvjMUygnm_hkh2FnT4B6jtC8BRVmZM",
    authDomain: "meetpersonal-c882f.firebaseapp.com",
    databaseURL: "https://meetpersonal-c882f-default-rtdb.firebaseio.com",
    projectId: "meetpersonal-c882f",
    storageBucket: "meetpersonal-c882f.firebasestorage.app",
    messagingSenderId: "1003303613688",
    appId: "1:1003303613688:web:79cfc60bd48329bbd0b70d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const salaRef = db.ref("sala_activa");
const perfilesRef = db.ref("perfiles");
const señalesRef = db.ref("señales");

const miIdUnico = "usuario_" + Math.random().toString(36).substr(2, 9);

// --- 2. VARIABLES DEL DOM ---
const pantallaLobby = document.getElementById('pantallaLobby');
const pantallaLlamada = document.getElementById('pantallaLlamada');
const videoPreview = document.getElementById('videoPreview');
const inputNombre = document.getElementById('inputNombre');
const miniAvatar = document.getElementById('miniAvatar');
const inputFoto = document.getElementById('inputFoto');
const btnUnirse = document.getElementById('btnUnirse');

const selectMicLobby = document.getElementById('selectMicLobby');
const selectCamLobby = document.getElementById('selectCamLobby');
const selectMicLlamada = document.getElementById('selectMicLlamada');
const selectCamLlamada = document.getElementById('selectCamLlamada');

const btnSilenciar = document.getElementById('btnSilenciar');
const btnApagarCam = document.getElementById('btnApagarCam');
const btnSalir = document.getElementById('btnSalir');
const contenedorParticipantes = document.getElementById('contenedorParticipantes');

let streamLocal = null;
let fotoBase64 = "";
let camaraActiva = true;
let microActivo = true;

const servidoresICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let conexionesRTC = {}; 

// --- 3. LÓGICA DEL LOBBY ---
inputNombre.addEventListener('blur', () => {
    const nombre = inputNombre.value.trim().toLowerCase();
    if (nombre === "") return;
    perfilesRef.child(nombre).once('value', (snapshot) => {
        if (snapshot.exists()) {
            fotoBase64 = snapshot.val().foto;
            miniAvatar.src = fotoBase64;
        }
    });
});

inputFoto.onchange = (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            fotoBase64 = e.target.result;
            miniAvatar.src = fotoBase64;
            const nombre = inputNombre.value.trim().toLowerCase();
            if(nombre !== "") perfilesRef.child(nombre).set({ foto: fotoBase64 });
        };
        reader.readAsDataURL(file);
    }
};

async function obtenerDispositivos() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const dispositivos = await navigator.mediaDevices.enumerateDevices();
        [selectMicLobby, selectMicLlamada, selectCamLobby, selectCamLlamada].forEach(s => s.innerHTML = '');

        dispositivos.forEach(dispositivo => {
            const option = document.createElement('option');
            option.value = dispositivo.deviceId;
            if (dispositivo.kind === 'audioinput') {
                option.text = dispositivo.label || `Microfono ${selectMicLobby.length + 1}`;
                selectMicLobby.appendChild(option.cloneNode(true));
                selectMicLlamada.appendChild(option);
            } else if (dispositivo.kind === 'videoinput') {
                option.text = dispositivo.label || `Camara ${selectCamLobby.length + 1}`;
                selectCamLobby.appendChild(option.cloneNode(true));
                selectCamLlamada.appendChild(option);
            }
        });
    } catch (e) { console.error("Permisos denegados"); }
}

async function iniciarStream(audioId, videoId) {
    if (streamLocal) streamLocal.getTracks().forEach(t => t.stop());
    try {
        streamLocal = await navigator.mediaDevices.getUserMedia({
            audio: audioId ? { deviceId: { exact: audioId } } : true,
            video: videoId ? { deviceId: { exact: videoId } } : true
        });
        videoPreview.srcObject = streamLocal;
        
        const miVideoLlamada = document.getElementById('video_' + miIdUnico);
        if (miVideoLlamada) miVideoLlamada.srcObject = streamLocal;

        streamLocal.getAudioTracks()[0].enabled = microActivo;
        streamLocal.getVideoTracks()[0].enabled = camaraActiva;

        iniciarDetectorDeAudio(streamLocal, miIdUnico);
        
        Object.keys(conexionesRTC).forEach(id => {
            const senderVideo = conexionesRTC[id].getSenders().find(s => s.track.kind === 'video');
            const senderAudio = conexionesRTC[id].getSenders().find(s => s.track.kind === 'audio');
            if(senderVideo) senderVideo.replaceTrack(streamLocal.getVideoTracks()[0]);
            if(senderAudio) senderAudio.replaceTrack(streamLocal.getAudioTracks()[0]);
        });

    } catch (error) { alert("Error al encender camara o microfono"); }
}

window.onload = async () => {
    await obtenerDispositivos();
    await iniciarStream();
};

[selectMicLobby, selectMicLlamada].forEach(s => s.onchange = (e) => {
    selectMicLobby.value = e.target.value; selectMicLlamada.value = e.target.value;
    iniciarStream(selectMicLobby.value, selectCamLobby.value);
});
[selectCamLobby, selectCamLlamada].forEach(s => s.onchange = (e) => {
    selectCamLobby.value = e.target.value; selectCamLlamada.value = e.target.value;
    iniciarStream(selectMicLobby.value, selectCamLobby.value);
});

// --- 4. ENTRAR A LA LLAMADA ---
btnUnirse.onclick = () => {
    const miNombre = inputNombre.value.trim() || "Usuario";
    pantallaLobby.style.display = "none";
    pantallaLlamada.style.display = "flex";

    const misDatos = {
        nombre: miNombre,
        foto: fotoBase64,
        camaraOn: camaraActiva,
        microOn: microActivo,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    
    salaRef.child(miIdUnico).set(misDatos);
    salaRef.child(miIdUnico).onDisconnect().remove();
    señalesRef.child(miIdUnico).onDisconnect().remove();

    crearTarjetaParticipante(miIdUnico, misDatos, streamLocal, true);
    escucharSeñalesWebRTC();
};

// --- 5. CONTROLES DE LA LLAMADA ---
btnSilenciar.onclick = () => {
    microActivo = !microActivo;
    streamLocal.getAudioTracks()[0].enabled = microActivo;
    btnSilenciar.innerText = microActivo ? "Microfono" : "Mic Apagado";
    btnSilenciar.classList.toggle("apagado");
    salaRef.child(miIdUnico).update({ microOn: microActivo });
};

btnApagarCam.onclick = () => {
    camaraActiva = !camaraActiva;
    streamLocal.getVideoTracks()[0].enabled = camaraActiva;
    btnApagarCam.innerText = camaraActiva ? "Camara" : "Cam Apagada";
    btnApagarCam.classList.toggle("apagado");

    const miVideo = document.getElementById('video_' + miIdUnico);
    const miAvatarCont = document.getElementById('avatarContainer_' + miIdUnico);
    
    if (!camaraActiva) {
        miVideo.style.opacity = "0";
        if (fotoBase64) miAvatarCont.style.display = "flex";
    } else {
        miVideo.style.opacity = "1";
        miAvatarCont.style.display = "none";
    }
    salaRef.child(miIdUnico).update({ camaraOn: camaraActiva });
};

btnSalir.onclick = () => {
    salaRef.child(miIdUnico).remove();
    señalesRef.child(miIdUnico).remove().then(() => window.location.reload());
};

// --- 6. GESTIÓN DE SALA FIREBASE ---
salaRef.on('child_added', (snapshot) => {
    const nuevoId = snapshot.key;
    const datos = snapshot.val();
    
    if (!datos || !datos.nombre) {
        salaRef.child(nuevoId).remove();
        return; 
    }

    if (nuevoId !== miIdUnico) {
        crearTarjetaParticipante(nuevoId, datos, null, false);
        salaRef.child(miIdUnico).once('value', (miSnap) => {
            if(miSnap.exists() && miSnap.val().timestamp < datos.timestamp) {
                conectarConUsuario(nuevoId);
            }
        });
    }
});

salaRef.on('child_changed', (snapshot) => {
    const id = snapshot.key;
    const datos = snapshot.val();
    if (id !== miIdUnico && datos && datos.nombre) {
        const avatarCont = document.getElementById('avatarContainer_' + id);
        const videoEl = document.getElementById('video_' + id);
        if(avatarCont && videoEl) {
             if(!datos.camaraOn) {
                 videoEl.style.opacity = "0";
                 if(datos.foto) avatarCont.style.display = "flex";
             } else {
                 videoEl.style.opacity = "1";
                 avatarCont.style.display = "none";
             }
        }
    }
});

salaRef.on('child_removed', (snapshot) => {
    const id = snapshot.key;
    const el = document.getElementById('container_' + id);
    if (el) el.remove();
    if (conexionesRTC[id]) {
        conexionesRTC[id].close();
        delete conexionesRTC[id];
    }
});

function crearTarjetaParticipante(id, datos, stream, esLocal) {
    if (document.getElementById('container_' + id)) return;

    const div = document.createElement('div');
    div.className = 'video-container';
    div.id = 'container_' + id;

    const video = document.createElement('video');
    video.id = 'video_' + id;
    video.autoplay = true;
    video.playsInline = true;
    if (esLocal) video.muted = true;
    if (stream) video.srcObject = stream;

    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'avatar-container';
    avatarContainer.id = 'avatarContainer_' + id;
    
    const onda = document.createElement('div');
    onda.className = 'onda';
    
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = datos.foto || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

    if(!datos.camaraOn && datos.foto) {
        avatarContainer.style.display = "flex";
        video.style.opacity = "0";
    }

    avatarContainer.appendChild(onda);
    avatarContainer.appendChild(img);

    const nombreLabel = document.createElement('div');
    nombreLabel.className = 'etiqueta-nombre';
    nombreLabel.innerText = datos.nombre;

    div.appendChild(video);
    div.appendChild(avatarContainer);
    div.appendChild(nombreLabel);
    
    contenedorParticipantes.appendChild(div);
}

// --- 7. MAGIA WEBRTC ---
function crearPeerConnection(idDestino) {
    const pc = new RTCPeerConnection(servidoresICE);
    conexionesRTC[idDestino] = pc;

    streamLocal.getTracks().forEach(track => pc.addTrack(track, streamLocal));

    pc.ontrack = (event) => {
        const videoRemoto = document.getElementById('video_' + idDestino);
        if (videoRemoto) {
            videoRemoto.srcObject = event.streams[0];
            iniciarDetectorDeAudio(event.streams[0], idDestino);
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            señalesRef.child(idDestino).child(miIdUnico).child('candidatos').push(event.candidate.toJSON());
        }
    };

    return pc;
}

async function conectarConUsuario(idDestino) {
    const pc = crearPeerConnection(idDestino);
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    señalesRef.child(idDestino).child(miIdUnico).set({ oferta: { type: oferta.type, sdp: oferta.sdp }});
}

function escucharSeñalesWebRTC() {
    señalesRef.child(miIdUnico).on('child_added', async (snapshot) => {
        const idRemoto = snapshot.key;
        const datos = snapshot.val();

        if (datos.oferta) {
            const pc = crearPeerConnection(idRemoto);
            await pc.setRemoteDescription(new RTCSessionDescription(datos.oferta));
            const respuesta = await pc.createAnswer();
            await pc.setLocalDescription(respuesta);
            señalesRef.child(idRemoto).child(miIdUnico).set({ respuesta: { type: respuesta.type, sdp: respuesta.sdp }});
        }
        
        señalesRef.child(miIdUnico).child(idRemoto).child('candidatos').on('child_added', (candSnap) => {
            if (conexionesRTC[idRemoto]) {
                conexionesRTC[idRemoto].addIceCandidate(new RTCIceCandidate(candSnap.val()));
            }
        });
    });

    señalesRef.child(miIdUnico).on('child_changed', async (snapshot) => {
        const idRemoto = snapshot.key;
        const datos = snapshot.val();
        if (datos.respuesta && conexionesRTC[idRemoto]) {
            await conexionesRTC[idRemoto].setRemoteDescription(new RTCSessionDescription(datos.respuesta));
        }
    });
}

// --- 8. DETECTOR DE ONDAS MULTI-USUARIO ---
function iniciarDetectorDeAudio(stream, idUsuario) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    
    source.connect(analyser);
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function detectarVolumen() {
        if(!stream || !stream.active) return; 
        analyser.getByteFrequencyData(dataArray);
        let suma = 0;
        for(let i = 0; i < dataArray.length; i++) suma += dataArray[i];
        const promedio = suma / dataArray.length;
        
        const container = document.getElementById('container_' + idUsuario);
        const avatarCont = document.getElementById('avatarContainer_' + idUsuario);

        if (container && avatarCont) {
            const micHabilitado = stream.getAudioTracks().length > 0 && stream.getAudioTracks()[0].enabled;
            if (promedio > 15 && micHabilitado) {
                container.classList.add('hablando');
                avatarCont.classList.add('hablando-avatar');
            } else {
                container.classList.remove('hablando');
                avatarCont.classList.remove('hablando-avatar');
            }
        }
        requestAnimationFrame(detectarVolumen);
    }
    detectarVolumen();
}

// --- 9. SISTEMA DE GRABACIÓN LOCAL ---
let grabador = null;
let fragmentosVideo = [];
const btnGrabar = document.getElementById('btnGrabar');
const tipoGrabacion = document.getElementById('tipoGrabacion');

btnGrabar.onclick = async () => {
    if (grabador && grabador.state === "recording") {
        grabador.stop();
        btnGrabar.innerText = "Grabar";
        btnGrabar.style.background = "#ffffff";
        btnGrabar.style.color = "#000000";
        return;
    }

    let streamParaGrabar;

    if (tipoGrabacion.value === "camara") {
        if (!streamLocal) {
            alert("Tu camara no esta encendida.");
            return;
        }
        streamParaGrabar = streamLocal;
    } else {
        try {
            const streamPantalla = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const contextoAudio = new (window.AudioContext || window.webkitAudioContext)();
            const destinoMezcla = contextoAudio.createMediaStreamDestination();
            
            if (streamLocal && streamLocal.getAudioTracks().length > 0) {
                const fuenteLocal = contextoAudio.createMediaStreamSource(streamLocal);
                fuenteLocal.connect(destinoMezcla);
            }
            
            if (streamPantalla.getAudioTracks().length > 0) {
                const fuentePantalla = contextoAudio.createMediaStreamSource(streamPantalla);
                fuentePantalla.connect(destinoMezcla);
            }
            
            let audioTrack = destinoMezcla.stream.getAudioTracks()[0];
            let tracksFinales = [streamPantalla.getVideoTracks()[0]];
            if (audioTrack) tracksFinales.push(audioTrack);

            streamParaGrabar = new MediaStream(tracksFinales);

            streamPantalla.getVideoTracks()[0].onended = () => {
                if (grabador && grabador.state === "recording") {
                    grabador.stop();
                    btnGrabar.innerText = "Grabar";
                    btnGrabar.style.background = "#ffffff";
                    btnGrabar.style.color = "#000000";
                }
            };

        } catch (error) {
            alert("Captura de pantalla cancelada o no soportada.");
            return;
        }
    }

    grabador = new MediaRecorder(streamParaGrabar);
    fragmentosVideo = [];

    grabador.ondataavailable = (evento) => {
        if (evento.data.size > 0) {
            fragmentosVideo.push(evento.data);
        }
    };

    grabador.onstop = () => {
        const blobVideo = new Blob(fragmentosVideo, { type: 'video/webm' });
        const urlVideo = URL.createObjectURL(blobVideo);
        
        const enlaceDescarga = document.createElement('a');
        enlaceDescarga.style.display = 'none';
        enlaceDescarga.href = urlVideo;
        enlaceDescarga.download = `Llamada_${new Date().getTime()}.webm`;
        
        document.body.appendChild(enlaceDescarga);
        enlaceDescarga.click();
        
        setTimeout(() => { 
            document.body.removeChild(enlaceDescarga); 
            window.URL.revokeObjectURL(urlVideo); 
        }, 100);
    };

    grabador.start();
    btnGrabar.innerText = "Detener";
    btnGrabar.style.background = "#ff1744"; 
    btnGrabar.style.color = "#ffffff";
};