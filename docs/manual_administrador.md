# Manual del administrador

Todo lo del [manual del asistente](manual_asistente.md) más las secciones del menú reservadas a administradores. El asistente no las ve ni puede abrirlas.

## Periodos

Un periodo (por ejemplo «2026-2») agrupa los horarios semanales de un semestre.

1. **Periodos → Nuevo periodo**: nombre, primer y último día (AAAA-MM-DD). Los periodos no se cruzan, estén activos o no.
2. **Activar**: solo uno puede estar activo a la vez; activar otro desactiva el anterior.
3. **Días sin servicio** (festivos, semana santa): agréguelos con rango y motivo. Ese día no habrá sesión ni se esperará a nadie.
4. Cada cambio muestra cuántas sesiones se **crearon, borraron, ajustaron o conservaron**. Una sesión con asistencia, con alarma o ya iniciada nunca se borra.
5. Eliminar un periodo solo es posible si no tiene horarios.

## Gestión de horarios

- **Nuevo horario**: nombre, día de la semana, inicio y fin (hora de Colombia) dentro del periodo elegido. No puede cruzarse con otro del mismo día y periodo; horarios contiguos sí.
- **Estudiantes**: asigne uno a uno (con fecha de inicio opcional), por lista de documentos (pegada o desde un archivo de texto; informa los que no existen, están de baja o ya estaban) o copiando los de otro horario.
- **Vista semanal**: cuadrícula de la semana con los días sin servicio marcados y el número de estudiantes de cada horario.
- Un horario con asistencia registrada no se puede eliminar; edítelo o déjelo.

## Estudiantes

- La tabla se filtra en el servidor por nombre, documento, carrera, estado y huella (útil: «Sin huella»).
- **Consentimiento**: el botón abre el texto vigente del servidor; se registra su versión, la fecha y quién lo hizo.
- **Importar CSV** (cuatro pasos): archivo, columnas (se sugieren por el encabezado), vista previa con fila y motivo de cada error, y resultado. Solo se importan las filas válidas; los datos de las filas no se guardan, solo cuántas se importaron. Descargue la plantilla desde el primer paso. Los importados quedan sin consentimiento ni huella.

- **Suprimir datos** (Ley 1581): el botón abre una confirmación en la que debe teclear el documento del estudiante. Elimina su huella y la de los lectores en la siguiente sincronización, y anonimiza su nombre, documento y carrera; sus asistencias se conservan sin identificarlo, para que los reportes sigan sumando. Queda marcado como «Datos suprimidos»; no se puede deshacer. Los respaldos anteriores conservan los datos hasta que vencen (ver `runbook.md`).
- **Dar de baja** a un estudiante cierra su vigencia en los horarios: desde ese día deja de contar como inasistencia en los reportes.

## Usuarios del panel

Cree cuentas, cambie nombre o rol, desactive y restablezca contraseñas. La **contraseña temporal** se muestra una sola vez en una ventana: anótela y ciérrela; no se puede volver a ver. Nadie puede desactivarse ni cambiar su propio rol, y el sistema nunca queda sin un administrador activo.

## Historial y auditoría

- **Historial → Ingresos y egresos**: filtros por fecha, horario, origen (huella o manual), estado y estudiante. Los registros manuales muestran el motivo y quién los hizo.
- **Historial → Sin conexión**: los eventos que el lector guardó sin conexión y no se aplicaron solos (por revisar, descartados, aprobados y corregidos), aparte de las sesiones. Las sesiones reconciliadas se ven en «Ingresos y egresos» con el origen **Sin conexión** (también como filtro). En **Alarmas** las que sonó el propio lector llevan la marca «Local (sin conexión)».
- **Alarma y mensajes** y **Alarmas**: qué orden se envió al lector, quién y con qué resultado; cómo y cuándo terminó cada alarma.
- **Auditoría**: quién hizo qué y cuándo (filtre por tipo, que busca por prefijo como `student.`, por usuario y por fecha). Nunca contiene huellas, contraseñas ni datos de contacto.

## Resumen y reportes

Al iniciar sesión, el administrador entra al **Resumen**: hoy, la semana (de lunes a hoy), el periodo activo y lo que requiere atención (lector, alarma, sesiones abiertas en horarios ya terminados, salidas no registradas de los últimos 7 días). **Reportes** (solo administrador) tiene seis pestañas: Afluencia, Asistencia, Permanencia, Llegadas tarde, Alarmas y Calidad de los datos. Los filtros (fechas, horario, programa y estudiante) quedan en la dirección de la página, así que se puede copiar el enlace. El rango máximo es de 366 días y las horas son de Bogotá.

Definiciones:

- **Calidad de los datos** incluye, cuando hay registros sin conexión en el rango, cuatro filas aparte: sesiones con origen sin conexión, eventos reconciliados, por revisar y descartados. La resolución de los pendientes (**Por revisar**) la pueden hacer el asistente y el administrador.
- **Obligación**: un estudiante asignado, con vigencia en el inicio de un horario ya terminado y que no cae en un día sin servicio.
- **Asistió**: tiene una sesión en esa ocurrencia; una salida no registrada también cuenta como asistencia. **Cumplimiento** = asistencias / obligaciones (sin obligaciones se muestra «—»).
- **Llegada tarde**: un minuto completo o más después del inicio, solo en entradas con huella.
- **Permanencia**: promedio solo de sesiones cerradas (nunca de las salidas no registradas).
- **Picos**: las horas, días y fechas con más entradas; se marcan con trama y el rótulo «Pico», no solo con color.
- Detalle por estudiante: en los reportes agrupados por estudiante, el nombre abre sus sesiones día por día. Ninguna pantalla ni archivo muestra la cédula.

**Exportar CSV**: el botón avisa que el archivo contiene datos personales (Ley 1581) y registra la exportación en la auditoría antes de entregarlo. El archivo es UTF-8 con BOM, separado por `;` y con coma decimal, para que Excel en español lo abra directamente (si no, use Datos → Desde texto/CSV y elija UTF-8). El texto que empieza con `=`, `+`, `-` o `@` se marca con un apóstrofo para que no se ejecute como fórmula. El archivo lleva los filtros del servidor y el orden de la tabla que ve; el cuadro «Buscar» de la tabla solo filtra la pantalla y no se aplica al archivo. Se rechaza si supera 20 000 filas: acote el rango. Guarde el archivo solo donde sea necesario y elimínelo al terminar.

Limitación conocida: dar de baja a un estudiante no cierra su vigencia en los horarios, así que sus ausencias siguen contando en los reportes hasta que se le quite de la asignación.

Datos de prueba: `npm --prefix server run seed:reports` carga un semestre simulado (documentos `SIM-…`) solo en bases cuyo nombre contenga demo, seed o test (o con `SEED_ALLOW=<nombre>`); `-- --reset` borra únicamente esa simulación.

## Desde la línea de comandos

- `gym schedule create … --period <id|nombre>` crea un horario semanal dentro de un periodo.
- `gym device register|rotate|revoke <id>` gestiona el token propio de cada lector (se muestra una sola vez; rotar o revocar cierra su conexión). `gym device status` muestra el estado del token.
- `gym student erase <documento> --yes` suprime los datos personales; `gym student erase --id <uuid> --reapply --yes` los vuelve a suprimir tras restaurar un respaldo antiguo.
- Alertas: si un lector lleva más de `DEVICE_OFFLINE_ALERT_MINUTES` sin conexión, el panel del asistente muestra un aviso rojo y queda `device.offline_alert` en la auditoría. Respaldos, restauración y rotación de claves: [`runbook.md`](runbook.md).
- `gym student edit <documento> --consented` registra el consentimiento del texto vigente; `gym enroll start` lo exige.
