# Matriz de pruebas — API de pedidos

Cada fila es un caso distinto. Las solicitudes `PRE-09a`, `PRE-09b`, el reinicio inicial y la limpieza final preparan o borran datos: no son casos.

Los identificadores de esta tabla son los nombres de las solicitudes y de las pruebas en Postman.

| ID | Operación | Riesgo | Precondiciones | Datos | Resultado esperado | Aserciones | Limpieza |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | POST /orders | Se acepta un alta inválida o se pierde el pedido creado | Almacén vacío. Ana autenticada | product Cafe, quantity 2, note sin azucar | 201. Pedido pendiente de Ana. El id queda en la variable `orderId` de esta corrida | Estado 201. product, quantity, note, status pending, owner ana, cancelledAt null. Id no vacío | No se borra: TC-02 y la cancelación lo usan. Lo borra la limpieza final |
| TC-02 | GET /orders/{id} | El alta respondió bien, pero no quedó guardada | TC-01 guardó `orderId` | Id de esta corrida. Token de Ana | 200. El recurso guardado coincide con lo creado | Mismo id, Cafe, quantity 2, nota, pending, owner ana, un evento created | No se borra |
| TC-03 | POST /orders | Falta un campo obligatorio y aun así se crea el pedido | Existe solo el pedido de TC-01 | Cuerpo con quantity 1 y sin product. Token de Ana | 400 VALIDATION_ERROR. No aumenta el total | Estado 400. details incluye product. El cuerpo no trae id. Un GET posterior sigue con total 1 | Nada que borrar: no hubo alta |
| TC-04 | POST /orders | Un número fuera de rango queda guardado | Sigue habiendo un solo pedido | product Cafe, quantity 0. Token de Ana | 400. quantity no está entre 1 y 100. No aumenta el total | Estado 400. issue must_be_between_1_and_100. GET posterior con total 1 | Nada que borrar |
| TC-05 | GET /orders | La lista se entrega sin autenticación | Hay un pedido de Ana | Sin encabezado Authorization | 401 UNAUTHORIZED. No devuelve items | Estado 401. detail Authorization required. No existe items | No modifica datos |
| TC-06 | GET /orders | Un token inventado pasa como usuario | Hay un pedido de Ana | Authorization Bearer token-que-no-existe | 401 UNAUTHORIZED | Estado 401. detail Authorization invalid. No existe items | No modifica datos |
| TC-07 | GET /orders/{id} | Luis lee el pedido de Ana | TC-01 creó el pedido de Ana | Id de Ana. Token de Luis | 403 FORBIDDEN. No filtra el producto ni el dueño | Estado 403. issue not_owner. El JSON no contiene product, owner ni Cafe | No modifica datos |
| TC-08 | GET /orders/{id} | Un id desconocido responde como si existiera | Ana autenticada | Id fijo 00000000-0000-4000-8000-000000000099 | 404 NOT_FOUND | Estado 404. detail id not_found. No existe product | No modifica datos |
| TC-09 | GET /orders?page=1&limit=2 | La página trae de más, de menos o pedidos de otro usuario | Ana tiene tres pedidos en este orden: Cafe, Te, Jugo | page 1, limit 2. Token de Ana | 200. Dos ítems, total 3, totalPages 2. Solo Cafe y Te | page, limit, total, totalPages, largo 2, productos y owner ana. Guarda los ids en `page1Ids` | Los pedidos siguen para TC-10. Los borra la limpieza final |
| TC-10 | GET /orders?page=2&limit=2 | La segunda página repite la primera o pierde el resto | TC-09 guardó `page1Ids`. Total 3 | page 2, limit 2. Token de Ana | 200. Un ítem, Jugo, y ese id no está en la página 1 | page 2, total 3, totalPages 2, largo 1, producto Jugo, id ausente de page1Ids | No se borra todavía |
| TC-11 | PUT /orders/{id}/cancel | Cancelar no cambia el estado o registra varias cancelaciones | El pedido de TC-01 sigue pending | Id de esta corrida. Token de Ana | 200. status cancelled, cancelledAt con fecha y un solo evento cancelled | Estado 200. Eventos exactamente created y cancelled. Guarda cancelledAt y eventCount | El pedido queda cancelado a propósito |
| TC-12 | PUT /orders/{id}/cancel y después GET /orders/{id} | La segunda llamada parece igual, pero el recurso guardado sí cambió | TC-11 guardó cancelledAt y eventCount | Mismo id. Token de Ana. Segunda llamada sin otro cuerpo | 200 en ambas. El pedido sigue cancelado una sola vez, con la misma fecha | La repetición conserva cancelledAt y un solo evento cancelled. El GET posterior confirma ese mismo efecto en el almacén | Lo borra la limpieza final |
| TC-13 | GET /orders?page=1&limit=10 | La respuesta de éxito no cumple el esquema OpenAPI | Existe el pedido de TC-01 y todavía no se crean Te ni Jugo | page 1, limit 10. Token de Ana | 200 JSON. Sobre OrderPage y el pedido cumple Order | Content-Type JSON. Claves exactas de la página y del pedido. Tipos, enum de status y owner, fecha, cancelledAt null, evento created | No se borra |
| TC-14 | POST /orders | El error no cumple el esquema, o un quantity de texto se guarda | Sigue habiendo un solo pedido | product Cafe, quantity "dos". Token de Ana | 400 JSON. ErrorResponse. quantity must_be_integer. Total sigue en 1 | Content-Type JSON. Solo la clave error. code, message y details con field e issue. GET posterior con total 1 | Nada que borrar |

## Cómo leer dos ideas que se parecen

TC-03 y TC-04 comprueban que el servidor rechaza el cuerpo de entrada: falta un obligatorio, o el valor no respeta el rango. Eso es validación del cuerpo.

TC-13 comprueba la respuesta de éxito contra el esquema Order y OrderPage: nombres, tipos y valores permitidos. No vuelve a validar el cuerpo enviado.

TC-14 hace las dos cosas con una petición distinta. El servidor rechaza quantity porque es texto, no entero. La prueba, además, exige que el JSON de error tenga exactamente la forma ErrorResponse del OpenAPI.

TC-12 no se conforma con que las dos respuestas PUT se parezcan. Después lee el pedido y comprueba el efecto final: una sola cancelación y la misma fecha.
