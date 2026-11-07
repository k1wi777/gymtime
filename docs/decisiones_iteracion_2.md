# Decisiones del usuario de la iteración 2

Registro de las decisiones tomadas por el usuario (dueño del producto) durante la
iteración 2. Cada una consta una sola vez aquí; los manuales y guías la enlazan.

1. **La baja de un estudiante es irreversible (Ley 1581).** Al dar de baja se elimina
   la huella (no se conserva más tiempo del necesario) y no existe reactivación: para
   que vuelva a entrar se registra de nuevo y se enrola otra vez. La supresión de datos
   personales (`gym student erase` o el panel) anonimiza al estudiante y conserva sus
   sesiones para que los reportes sigan sumando. Implementado en H11.
2. **Salir y volver a entrar no está permitido.** Un estudiante que ya marcó salida en
   un horario recibe `ALREADY_EXITED`; el tiempo de salida es fijo por horario y entrar
   o salir de nuevo no da más tiempo.
3. **La exportación es solo CSV.** No se ofrecen XLSX ni PDF (CSV con BOM, `;` y fechas
   en hora de Bogotá, que abre directamente Excel).
4. **La importación no sobrescribe estudiantes existentes.** Un documento que ya existe
   es un error de esa fila (no se actualiza ni se omite en silencio); las demás filas
   válidas sí se importan.
5. **Los eventos sin conexión (ventana de 72 h) quedan listos pero sin probar** hasta
   contar con el ESP32 real: el servidor y el simulador los cubren
   (`docs/modo_sin_conexion_firmware.md`), pero la atomicidad de LittleFS, la hora tras
   un reinicio sin red y la deriva del reloj solo se verifican con hardware.
6. **El estado de los periféricos lo reportará el ESP32** con un mensaje aditivo
   futuro (iteración 3). No está implementado: no hay mensaje, tabla ni pantalla de
   periféricos en esta iteración.
