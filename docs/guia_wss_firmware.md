# Guía de `wss://` y tokens para el equipo de firmware

En producción el lector deja de hablar `ws://` en red local y se conecta por
Internet a `wss://api.<dominio>/device`. El **protocolo no cambia** (mismos
mensajes, misma versión `v`); cambian el transporte y la credencial.

## 1. Transporte `wss://`

- El TLS lo termina el proxy (Caddy) con un certificado público (Let's Encrypt).
  El firmware solo necesita un cliente TLS (en Arduino/ESP32, `WiFiClientSecure`
  o la opción `wss` de la librería WebSocket que se use).
- **Valida el certificado.** No uses `setInsecure()`. Carga el certificado raíz
  del emisor (hoy ISRG Root X1 de Let's Encrypt) y acepta que Let's Encrypt
  pueda cambiar de raíz: lo más seguro es llevar la raíz actual y la siguiente
  y poder actualizarlas con el firmware.
- **La hora debe estar sincronizada antes de abrir TLS.** Con el reloj en 1970 la
  validación del certificado falla. Sincroniza por NTP al conectar el wifi y
  espera a tener hora válida antes de abrir el WebSocket. Esa falla aparece como
  error de handshake, no como `ack` del servidor (ver `docs/integracion_firmware.md`,
  8.1.4).
- Memoria: el handshake TLS consume bastante RAM en el ESP32. Abre una sola
  conexión, no la cierres sin motivo y reutiliza el cliente al reconectar.
- Mantén el `heartbeat`/`status` de siempre; el proxy no corta una conexión
  que envía tramas dentro de su plazo.

## 2. Token propio del lector

El administrador registra el lector y recibe un token **una sola vez**:

```bash
gym device register esp32-01
```

El token (`gt_dev_...`) se compila o se guarda en la memoria protegida del
dispositivo y se envía en el campo `token` de cada `hello`, exactamente como
antes. **No cambia el esquema del mensaje.**

| Situación | Qué ve el firmware |
|---|---|
| Token correcto | `hello` aceptado, sigue el flujo normal. |
| Token desconocido o revocado | `ack` de error `UNAUTHORIZED` y cierre `4401`. |
| El administrador rota o revoca el token con la conexión abierta | La conexión se cierra con código **`4410`** (motivo `token_revoked`). |

Qué hacer ante `4410`: **no reintentes en bucle** con el mismo token. Reintenta
con el token que tenga guardado a un ritmo lento (por ejemplo cada 30–60 s,
subiendo hasta unos minutos); si el administrador ya flasheó el token nuevo, la
siguiente conexión funcionará. Mientras tanto el lector sigue operando sin
conexión con lo que tiene guardado y reconcilia después (principio del
proyecto).

Rotar un token exige volver a flashear o actualizar el valor guardado: es la
razón de que se haga solo ante una sospecha de filtración o al retirar un lector.
Guarda el token fuera del control de versiones y no lo imprimas en el puerto
serie.

## 3. Transición con el token compartido

Mientras haya lectores con el `DEVICE_TOKEN` compartido, el servidor lo sigue
aceptando para los lectores **sin token propio y no revocados**, y deja un aviso
en el log. Orden recomendado:

1. Registrar el lector (`gym device register esp32-01`) y flashear su token.
2. Comprobar con `gym device status` que la columna `token` dice `own`.
3. Quitar `DEVICE_TOKEN` del entorno de producción y reiniciar.

## 4. Lista de comprobación

- [ ] El lector abre `wss://api.<dominio>/device` y valida el certificado.
- [ ] La hora está sincronizada por NTP antes del handshake.
- [ ] Envía `hello` con su token propio; `gym device status` muestra `own` y conectado.
- [ ] Ante `UNAUTHORIZED` o cierre `4410` no reintenta de forma agresiva.
- [ ] El token no aparece en logs ni en el repositorio del firmware.
