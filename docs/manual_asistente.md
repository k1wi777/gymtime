# Manual del asistente

Guía corta del panel web de GymTime para el asistente del gimnasio. Todas las horas se muestran en hora de Bogotá.

## Entrar y salir

1. Abra el panel (por defecto `http://localhost:3000`) e inicie sesión con su usuario y contraseña.
2. Si es su primer ingreso, el panel le pedirá elegir una contraseña nueva (mínimo 10 caracteres) antes de continuar.
3. Tras 30 minutos sin actividad la sesión se cierra sola; el panel le avisará y bastará con entrar de nuevo. Use «Cerrar sesión» al terminar.

## Ahora

Es la pantalla principal. Muestra el horario en curso, el tiempo restante y tres listas: **Dentro**, **Faltan** y **Salieron**, más los últimos escaneos del lector. Se actualiza sola cuando alguien pone la huella; no hace falta recargar.

- «Sin huella» junto a un nombre en **Faltan** significa que esa persona aún no tiene huella enrolada.
- «Salida no registrada» indica que la persona no marcó salida y la sesión se cerró al apagar la alarma o al vencer el plazo.
- El indicador **Conectado** (arriba) confirma que la pantalla está al día.

## Registro manual

Para quien no pudo usar la huella.

1. Elija **Registrar entrada** o **Registrar salida**.
2. Busque al estudiante por nombre o documento y selecciónelo.
3. Escriba el motivo (es obligatorio; queda guardado junto con su usuario).
4. Confirme en la ventana que aparece.

## Enrolar huella

1. Entre a **Enrolar huella** y pulse «Elegir» en el estudiante.
2. El estudiante debe tener **consentimiento** registrado. Sin él, el botón «Iniciar enrolamiento» queda desactivado. Si el estudiante lo firmó y falta anotarlo, use «Registrar consentimiento…»: el panel muestra el texto vigente que guarda el servidor; léalo con el estudiante y marque la casilla. El servidor guarda la versión del texto, la fecha y quién lo registró. Si intenta enrolar sin consentimiento, el servidor lo rechaza con el aviso «Falta el consentimiento del estudiante».
3. Pulse «Iniciar enrolamiento» y siga las indicaciones: el estudiante pone el dedo, lo retira y lo pone de nuevo en el lector.
4. Termina con «Huella registrada». Puede cancelar con «Cancelar enrolamiento». Mientras dura, el lector no registra asistencia.
5. Si el lector falla o se acaba el tiempo, use «Intentar de nuevo».

La huella se carga en el lector antes del próximo horario del estudiante.

## Alarma y mensajes

- **Encender / Probar / Apagar alarma:** al apagar con gente adentro, las sesiones abiertas se cierran como «no registrada» (sin hora de salida); el panel pide confirmación.
- Cuando la alarma suena aparece un aviso rojo en todas las pantallas con el motivo y cuántas personas siguen dentro.
- **Mensaje en pantalla:** hasta dos líneas de 16 caracteres, sin tildes especiales. Si el lector está sin conexión, el mensaje queda en cola y se muestra al reconectarse.
- «Órdenes recientes» muestra si el lector confirmó cada orden.

## Dispositivo y horarios

**Dispositivo** indica si el lector está conectado y cuándo respondió por última vez. **Horarios** lista los horarios y sus asistentes (solo consulta; los cambios los hace el administrador).

## Qué hacer si el panel dice «Desconectado»

1. Espere unos segundos: el panel reintenta solo y vuelve a «Conectado»; al volver, actualiza las listas.
2. Si sigue desconectado, revise que tenga internet o red local y recargue la página (F5).
3. Si el panel le lleva al inicio de sesión, su sesión expiró: entre de nuevo.
4. Si nada funciona, avise al administrador: puede que el servidor esté apagado. Mientras tanto, anote a mano las entradas y salidas y regístrelas después con **Registro manual**.
5. Si aparece el aviso rojo **«Lector sin conexión»**, el lector lleva más de unos minutos (5 por defecto) sin conectarse y el administrador ya fue alertado. Revise su alimentación y el Wi‑Fi; mientras tanto registre a mano con **Registro manual**. El aviso desaparece solo cuando el lector vuelve.
6. Si el problema es el **lector** (Dispositivo dice «sin conexión»), revise su alimentación y el Wi‑Fi; la guía de firmware está en [`integracion_firmware.md`](integracion_firmware.md), sección 8.

## Sobre los datos de huella

Si un estudiante pide que se borren sus datos, avise al administrador: solo él puede suprimirlos (ver su manual).

Solo se guarda la plantilla cifrada, nunca la imagen. Sin consentimiento no se puede enrolar: lo exige el servidor (no solo el panel). Los estudiantes que ya existían antes de esta versión quedan con el consentimiento provisional `v1-provisional`, fechado el día de su registro.
