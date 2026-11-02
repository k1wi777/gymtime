# GymTime UniCórdoba: contexto de la idea

Documento para que cualquier persona del equipo, o quien se sume después, entienda **qué problema resolvemos, cuál es la idea, cómo funcionará la solución y en qué situaciones se usará**. No entra en detalles técnicos; para eso está `detalles_de_software.md`.

> El nombre "GymTime UniCórdoba" es provisional.

---

## 1. El problema

El gimnasio institucional de la Universidad de Córdoba funciona por **horarios de aproximadamente una hora**. Cada horario tiene un grupo de estudiantes asignado, y todos deben salir cuando el horario termina para que entre el siguiente grupo.

Hoy ese control depende de que una persona esté pendiente. Esto genera varios problemas:

- Alguien tiene que vigilar el reloj y avisar a quienes se pasan del tiempo.
- No hay un registro confiable de quién entró, a qué hora y cuánto tiempo estuvo.
- No se sabe con certeza quién asistió y quién faltó a su horario.
- La administración no tiene datos para tomar decisiones: horas con más gente, estudiantes que dejan de asistir, uso real del gimnasio.

## 2. La idea en una frase

Un sistema donde cada estudiante **marca su entrada y su salida con la huella**, que avisa con una **alarma** cuando termina el horario y todavía hay gente adentro, y que **guarda todo** para que los encargados del gimnasio consulten listados, controlen en vivo y generen reportes.

## 3. Objetivos

**Objetivo principal:** que el control del tiempo de permanencia no dependa de que una persona lo vigile.

**Objetivos secundarios:**

- Saber en todo momento quién está dentro del gimnasio y quién falta.
- Garantizar que solo entren los estudiantes asignados a cada horario.
- Dar a la administración métricas de asistencia y uso del gimnasio.
- Mantener el costo lo más bajo posible.
- Proteger los datos personales y biométricos de los estudiantes.

## 4. Cómo funciona

El sistema tiene tres partes:

```
   ┌─────────────────────┐        internet        ┌─────────────────────┐        ┌─────────────────────┐
   │  DISPOSITIVO EN EL  │ ◄────────────────────► │      SERVICIO       │ ◄────► │     PANEL WEB       │
   │      GIMNASIO      │                         │      EN LA NUBE     │        │ (asistente / admin) │
   │ huellero, pantalla, │                         │  guarda los datos y │        │  desde cualquier    │
   │ alarma, botón       │                         │  toma las decisiones│        │  computador         │
   └─────────────────────┘                         └─────────────────────┘        └─────────────────────┘
```

1. **Dispositivo en el gimnasio.** Es lo que ve el estudiante: un lector de huellas, una pantalla que le dice qué pasó, una alarma y un botón. Es "el brazo físico" del sistema: captura datos y ejecuta órdenes.
2. **Servicio en la nube.** Es el "cerebro". Recibe lo que captura el dispositivo, decide si la persona puede entrar, registra entradas y salidas, y calcula las métricas.
3. **Panel web.** Es la herramienta de los encargados. Desde el computador pueden ver quién está dentro, hacer registros manuales, registrar huellas nuevas, crear horarios y ver reportes.

El dispositivo no toma decisiones complejas: le pregunta al servicio y muestra la respuesta. La excepción es cuando se cae el internet, donde sigue funcionando con lo que tenía guardado (ver caso de uso 12).

## 5. Quiénes lo usan

| Persona | Qué hace con el sistema |
|---|---|
| **Estudiante** | Pone su huella al entrar y al salir. Lee en la pantalla si todo salió bien. No necesita nada más. |
| **Asistente del gimnasio** | Atiende el día a día desde el panel: ve quién está dentro, hace registros manuales cuando algo falla, registra huellas nuevas y puede encender o apagar la alarma. |
| **Administrador** | Todo lo del asistente, más: crea los horarios, define qué estudiantes pertenecen a cada uno, ve todas las métricas y administra los usuarios del panel. |

## 6. Reglas de la idea

1. **Cada horario tiene una hora de inicio y de fin fijas.** La hora de salida es **la misma para todos** los estudiantes de ese horario.
2. **Se puede entrar en cualquier momento dentro de la hora válida del horario**, pero se debe salir a la hora de fin. Entrar tarde no da más tiempo.
3. **Solo entran los estudiantes asignados** a ese horario.
4. **Se identifica solo por huella.** No hay tarjetas ni claves para los estudiantes.
5. **Entrada y salida usan el mismo lector.** El sistema sabe cuál es cuál: si la persona no estaba registrada adentro, es una entrada; si ya estaba, es una salida.
6. **La alarma suena** cuando el horario termina y queda al menos una persona que no ha marcado su salida.
7. **La alarma se apaga** cuando todos los que estaban adentro marcan su salida. También puede apagarla el botón físico o el asistente desde el panel.
8. **Si el huellero falla**, el asistente puede registrar entradas y salidas a mano desde el panel.
9. **Todo queda registrado**: quién, qué y cuándo.

## 7. Casos de uso

### Estudiantes

**1. Entrada normal**
El estudiante llega a su horario y se acerca al dispositivo. La pantalla se enciende al detectar que hay alguien cerca. Pone su huella y la pantalla muestra su nombre y "Entrada registrada".

**2. Salida normal**
Antes de que termine el horario, el estudiante pone de nuevo su huella. La pantalla muestra "Salida registrada" y su sesión se cierra. El sistema guarda cuánto tiempo estuvo.

**3. Entrada tarde**
El estudiante llega 20 minutos después de que empezó el horario. Puede entrar, pero igual debe salir a la hora de fin del horario.

**4. Estudiante que no pertenece al horario**
Alguien con huella registrada intenta entrar en un horario que no le corresponde. La pantalla indica que no pertenece a este horario y no se registra la entrada.

**5. Huella no reconocida**
Alguien pone una huella que no está en el sistema, o el lector no la lee bien. La pantalla muestra "Huella no reconocida" y puede intentar de nuevo.

**6. Se acaba el horario y alguien no salió**
Llega la hora de fin y hay estudiantes que no han marcado su salida. Suena la alarma. Cada estudiante que marca su salida cierra su sesión, y cuando sale el último, la alarma se apaga sola.

**7. Un estudiante se fue sin marcar la salida**
Es el caso típico de una alarma que no se apaga porque la persona ya no está. El asistente puede registrar su salida manualmente desde el panel (caso 9) o apagar la alarma con el botón. La sesión queda marcada como "salida no registrada" para que se vea en los reportes.

### Asistente

**8. Primera vez de un estudiante: registrar su huella**
El estudiante llega por primera vez. El asistente lo busca en el panel y pulsa "Registrar huella". El dispositivo pasa a modo de registro y el estudiante pone el dedo varias veces. Al terminar, la huella queda asociada a su perfil y desde ese momento puede usar el gimnasio.

**9. El huellero falla**
El lector no funciona o la huella de un estudiante no se lee. El asistente registra la entrada o la salida a mano desde el panel, y escribe el motivo. El registro queda marcado como manual.

**10. Ver cómo va el horario en vivo**
El asistente abre el panel y ve, para el horario en curso: quiénes deben asistir, quiénes ya entraron, quiénes siguen dentro, quiénes ya salieron y quiénes faltan.

**11. Controlar la alarma a mano**
El asistente puede hacer sonar la alarma si lo necesita (por ejemplo, para avisar que el horario terminó) o apagarla si ya resolvió la situación.

### Cuando algo falla

**12. Se cae el internet**
El dispositivo sigue funcionando con la información del horario que ya tenía cargada. Reconoce a los estudiantes, registra entradas y salidas, y hace sonar la alarma a la hora de fin. Cuando vuelve la conexión, envía al servicio todo lo que registró.

**13. Se va la luz**
El dispositivo cuenta con un respaldo de batería, así que no se apaga. Cuando vuelve la energía, se reconecta y sincroniza lo pendiente.

**14. El dispositivo se desconecta**
El panel muestra que el dispositivo no está en línea y desde cuándo, para que el asistente pueda revisar y registrar a mano mientras tanto.

### Administrador

**15. Crear los horarios**
El administrador define los horarios (por ejemplo, de 6:00 a 7:00) y asigna a cada uno la lista de estudiantes. Antes de cada horario, el sistema deja listo el dispositivo con las huellas de ese grupo.

**16. Consultar métricas y reportes**
El administrador puede ver, entre otras cosas:

- Cuántas personas entraron en una hora específica.
- Qué días hay más afluencia y cuáles son las horas pico.
- Quiénes faltaron a su horario.
- Cuántas veces faltó un estudiante frente a los días que le correspondía asistir.
- Cuánto tiempo estuvo un estudiante entrenando en una sesión y su promedio en 1 mes o en 4 meses.
- Cuántas veces sonó la alarma.

**17. Dar de baja a un estudiante**
Cuando un estudiante deja de usar el gimnasio, se le da de baja: ya no aparece en los horarios y su huella puede eliminarse del sistema.

## 8. Qué dispositivos físicos intervienen

En lenguaje simple, el dispositivo del gimnasio incluye:

- **Lector de huellas:** identifica al estudiante.
- **Pantalla:** le dice al estudiante si su registro fue correcto o si hubo un error.
- **Sensor de proximidad:** enciende la pantalla cuando alguien se acerca.
- **Alarma (sirena):** suena al terminar el horario si queda gente adentro.
- **Botón:** apaga la alarma.
- **Respaldo de batería:** evita que se apague si falla la corriente.
- **Microcontrolador (ESP32):** conecta todo lo anterior con internet.

Los detalles y precios están en `lista_componentes_gimnasio.md`.

## 9. Datos personales y huellas

- Las huellas son **datos biométricos sensibles**. En Colombia los regula la **Ley 1581** de protección de datos personales: se requiere el **consentimiento explícito** del estudiante, una finalidad clara y medidas de seguridad reforzadas.
- **No se guarda la imagen de la huella**, solo una plantilla matemática que no permite reconstruirla.
- Las plantillas se guardan **cifradas**.
- El acceso al sistema está limitado por roles y las acciones importantes quedan registradas.
- Una huella no se puede cambiar si se filtra, por eso se guardan los mínimos datos posibles.

## 10. Qué incluye y qué no

**Incluido en el alcance:**

- Entrada y salida con huella.
- Control de horarios y listados de estudiantes.
- Alarma al terminar el horario.
- Panel para asistentes y administradores.
- Registros manuales como respaldo.
- Métricas y reportes de asistencia.
- Funcionamiento básico sin internet.

**Fuera del alcance (por ahora):**

- Cobros, pagos o membresías.
- Tarjetas, claves u otros métodos de identificación para los estudiantes.
- Aplicación móvil para estudiantes.
- Control de máquinas, casilleros o puertas.
- Más de un gimnasio o más de un dispositivo.

> Si más adelante se quiere crecer, el diseño deja la puerta abierta a más dispositivos, pero el primer objetivo es un solo gimnasio con un solo dispositivo.

## 11. Resultado esperado

- Ya no hace falta que alguien vigile el reloj: la alarma avisa sola.
- Cada estudiante sale a tiempo, y los grupos no se mezclan.
- El gimnasio tiene un registro confiable de asistencia y permanencia.
- La administración puede decidir con datos: ajustar horarios, detectar horas saturadas y ver quién deja de asistir.
- Todo con un costo bajo y con datos protegidos.

## 12. Preguntas abiertas de la idea

Estas decisiones aún no están cerradas y conviene hablarlas con quien administra el gimnasio:

1. **Alarma apagada a mano:** si el botón o el asistente la apagan y aún hay gente adentro, ¿queda apagada o debe volver a sonar?
2. **Salir y volver a entrar** dentro del mismo horario: ¿se permite?
3. **Margen para entrar:** ¿se puede entrar unos minutos antes del inicio? ¿Hasta qué minuto se puede entrar?
4. **Estudiantes que se van sin marcar la salida:** ¿cuánto tiempo después del horario se cierra su sesión automáticamente?
5. **Origen de los listados:** ¿los estudiantes se cargarán desde un archivo (Excel) o se registrarán uno por uno? ¿La universidad tiene ya una lista oficial?
6. **Sirena:** ¿también debe tener respaldo de batería?

## 13. Glosario

| Término | Significado |
|---|---|
| **Sesión** | El periodo entre la entrada y la salida de un estudiante. |
| **Horario** | Franja fija del día (por ejemplo, 6:00 a 7:00) con un grupo asignado. |
| **Plantilla de huella** | Datos matemáticos extraídos de la huella. Es lo único que se guarda; no es una imagen. |
| **Enrolar / registrar huella** | Capturar por primera vez la huella de un estudiante y asociarla a su perfil. |
| **Registro manual** | Entrada o salida que el asistente anota desde el panel cuando el lector falla. |
| **Panel web** | Página web que usan el asistente y el administrador. |
| **Servicio en la nube** | Programa en internet que guarda los datos y toma las decisiones. |
| **ESP32** | Pequeña placa electrónica que conecta el lector, la pantalla y la alarma con internet. |

## 14. Documentos del proyecto

| Archivo | Para qué sirve |
|---|---|
| `contexto_de_la_idea.md` | Este documento: la idea, el objetivo y los casos de uso. |
| `detalles_de_software.md` | Planeación técnica del software. |
| `Ficha_de_Software_GymTime.pdf` | Ficha resumida de las funcionalidades del software. |
| `lista_componentes_gimnasio.md` | Componentes de hardware y precios. |
