-- Etapa A: torna visível a Delivery presa em SENDING quando o processo
-- morre entre a Meta aceitar a mensagem e o SENT ser gravado. Não reusa
-- FAILED porque FAILED afirma "não foi", o que pode ser mentira aqui.
ALTER TYPE "DeliveryStatus" ADD VALUE 'SEND_UNCERTAIN';
