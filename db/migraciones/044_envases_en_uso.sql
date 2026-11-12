-- «Envases» se vuelve un ajuste de la empresa (Configuración → Preferencias → Envases), con la respuesta del registro
-- (empresas.control_retornables, 008). Apagado no se ve Finanzas → Envases. Las empresas que ya tienen algún sabor
-- retornable lo usan: se les enciende para que no pierdan la pestaña. Sólo datos. Repetible:  npm run db:migrar

UPDATE empresas e SET control_retornables = true
 WHERE NOT e.control_retornables
   AND EXISTS (SELECT 1 FROM productos p WHERE p.id_empresa = e.id_empresa AND p.retornable);
