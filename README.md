# API de pedidos

Práctica de validación con OpenAPI 3.1 y Postman. La aplicación es un servidor local, sin base de datos y sin interfaz gráfica.

Ana y Luis hacen pedidos por separado. Cada uno solo puede ver y cancelar los suyos. Los pedidos viven en memoria: al reiniciar el servidor, o al llamar `POST /test/reset`, la lista queda vacía. Por eso una corrida no depende de los ids de la anterior.

## Operaciones

| Método y ruta | Para qué sirve | ¿Se puede repetir sin cambiar el resultado? |
| --- | --- | --- |
| GET /orders | Lista mis pedidos, de a una página | Sí. Solo lee |
| POST /orders | Crea un pedido pendiente | No. Cada llamada crea otro pedido |
| GET /orders/{id} | Consulta un pedido mío | Sí. Solo lee |
| PUT /orders/{id}/cancel | Deja el pedido cancelado | Sí. La segunda vez no cambia la fecha ni agrega otro evento |

La cancelación es idempotente porque guarda un estado. La primera vez pasa de `pending` a `cancelled`, escribe `cancelledAt` y agrega un evento `cancelled`. Si ya estaba cancelado, responde 200 y no toca nada. El caso TC-12 no compara solo las dos respuestas: después lee el pedido y comprueba que en memoria sigue habiendo una sola cancelación.

No hay un encabezado de idempotencia. POST no se trata como idempotente.

## Requisitos

- Node.js. La corrida registrada usó v22.19.0.
- Postman CLI 1.67.0. No hace falta iniciar sesión ni tener una cuenta de Postman.
- No hace falta base de datos, interfaz gráfica ni despliegue público.

## Usuarios de prueba

El ambiente de ejemplo no trae contraseñas ni datos personales. Ana y Luis son usuarios ficticios. Los valores de autorización son fixtures locales de esta práctica, no credenciales reales, y están en `postman/environments/local.environment.yaml`.

| Usuario | Token | Variable |
| --- | --- | --- |
| Ana | ana-local-token | token_ana |
| Luis | luis-local-token | token_luis |

El encabezado es `Authorization: Bearer <token>`.

## Dos comprobaciones distintas

Validar el cuerpo es trabajo del servidor. Si falta `product`, si `quantity` es 0 o si `quantity` es el texto `"dos"`, responde 400 y no guarda el pedido. Eso son TC-03, TC-04 y la parte de entrada de TC-14.

Validar el esquema de la respuesta es trabajo de la prueba, contra el OpenAPI. TC-13 exige que la página y el pedido traigan exactamente las propiedades, tipos y valores del contrato. TC-14 exige lo mismo para el JSON de error. Una respuesta 201 con el campo renombrado seguiría siendo un alta, pero fallaría el esquema.

## Preparación de datos

El servidor arranca con la lista vacía. La primera solicitud de la colección llama a `POST /test/reset` y la última vuelve a vaciarla. Los pedidos de la corrida (Cafe, Te y Jugo) se crean durante esa misma ejecución. El id se guarda en una variable de la colección y no se copia de una corrida anterior.

## Inicio de la API

En esta carpeta:

```bash
node src/server.js
```

También vale `npm start`. El proceso debe quedar abierto. Escucha en `http://localhost:3000`.

## Ejecución de pruebas

Con el servidor ya iniciado, en otra terminal:

```bash
npm run test:api
```

Ese comando es:

```bash
postman collection run "postman/collections/api-pedidos" -e "postman/environments/local.environment.yaml" --no-report-events --disable-unicode
```

La matriz tiene 14 casos, TC-01 a TC-14. La corrida completa ejecuta 19 solicitudes y 40 aserciones: los 14 casos, más el reinicio, dos altas de preparación para la paginación y la limpieza final.

En Collection Runner de la app Postman el recorrido es el mismo: importar la carpeta `postman/collections/api-pedidos`, importar `postman/environments/local.environment.yaml`, elegir el ambiente Local y correr la colección una vez. La ejecución que quedó registrada se hizo con Postman CLI, que es el runner de línea de comandos de esa colección.

No hace falta iniciar sesión en Postman. La corrida es local.

## Versiones y formato

| Pieza | Versión o formato |
| --- | --- |
| Node.js | v22.19.0 |
| Postman CLI | 1.67.0 |
| Contrato | OpenAPI 3.1.0, archivo `openapi/pedidos.openapi.yaml` |
| Colección | Postman v3, un YAML por solicitud en `postman/collections/api-pedidos` |
| Ambiente | Postman v3, `postman/environments/local.environment.yaml` |

La colección v3 es el formato que lee este CLI. Collection Runner de una app reciente importa esa misma carpeta.

## Qué cubre la matriz

La matriz completa está en `docs/matriz-pruebas.md`. Hay 14 casos. `PRE-09a`, `PRE-09b`, el reinicio y la limpieza preparan datos y no cuentan como casos.

| Pedido de la práctica | Casos |
| --- | --- |
| Alta válida y consulta posterior | TC-01, TC-02 |
| Campo obligatorio y dato inválido | TC-03, TC-04 |
| Sin credenciales y token inválido | TC-05, TC-06 |
| Recurso de otra persona | TC-07 |
| Recurso que no existe | TC-08 |
| Paginación | TC-09, TC-10 |
| Repetir una operación idempotente y mirar el efecto final | TC-11, TC-12 |
| Esquema de éxito y esquema de error | TC-13, TC-14 |

## Evidencia de ejecución

Cada corrida ejecutó 19 solicitudes y 40 aserciones, que cubren los 14 casos de la matriz.

| Corrida | Archivo | Código | Solicitudes | Aserciones fallidas |
| --- | --- | --- | --- | --- |
| Fallo controlado: la respuesta usó `qty` en lugar de `quantity` | `evidence/falla-esquema.txt` | 1 | 19 | 4 |
| Corrección: se restauró `quantity` sin cambiar el contrato | `evidence/ejecucion-exitosa.txt` | 0 | 19 | 0 |

Las cuatro aserciones fallidas fueron TC-01, TC-02, TC-13 y TC-12. Las otras solicitudes respondieron, pero el nombre del campo ya no cumplía el esquema.

## Incompatibilidad de esquema

El contrato pide la propiedad `quantity`. En `src/server.js`, dentro de `toOrder`, esa propiedad se renombró un momento a `qty`. El OpenAPI y las pruebas no se modificaron.

La corrida contra ese defecto está en `evidence/falla-esquema.txt`. Postman CLI terminó con código 1: 40 aserciones, 4 fallidas.

- TC-01 y TC-02 esperaban `quantity` igual a 2 y recibieron `undefined`.
- TC-13 esperaba las claves del esquema Order, incluida `quantity`.
- TC-12, al leer el efecto final, también esperaba `quantity` igual a 2.

El resto siguió pasando: la paginación, los errores y el cambio de estado a `cancelled` no miran ese nombre. Por eso el defecto es del contrato, no de “la API no arranca”.

Después se restauró `quantity: order.quantity`. La corrida corregida está en `evidence/ejecucion-exitosa.txt`. Código 0: 40 aserciones, 0 fallidas.

## Mapa de archivos

- `src/server.js` — la API, en un solo archivo para poder seguirla en clase.
- `openapi/pedidos.openapi.yaml` — el contrato.
- `docs/matriz-pruebas.md` — los 14 casos.
- `postman/collections/api-pedidos` — solicitudes y pruebas, con el id del caso en el nombre.
- `postman/environments/local.environment.yaml` — ambiente de ejemplo, sin contraseñas ni datos personales.
- `evidence/` — la corrida que falla y la corrida que pasa.
