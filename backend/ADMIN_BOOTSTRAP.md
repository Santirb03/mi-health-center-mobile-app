# Primer administrador (procedimiento manual controlado)

El registro público crea DOCTOR. No acepta rol ADMIN. La promoción del primer administrador es una operación del responsable de la base, no una función pública ni un seed automático al arrancar.

1. Identifica el entorno y la base de destino; confirma respaldo recuperable si tiene datos. Verifica si ya existe un administrador antes de crear otro.
2. Registra la cuenta del administrador mediante la app; el titular establece su contraseña. Confirma su identidad y correo exacto.
3. Con una conexión administrativa a la base correcta, abre una transacción y consulta `id`, `email`, `role` de esa cuenta. Comprueba que sea exactamente una fila.
4. Actualiza **solo ese id**: `role = 'ADMIN'`, `refreshTokenHash = NULL`, `updatedAt = CURRENT_TIMESTAMP`. Revisa la fila con `RETURNING id, email, role`. Si el id, entorno o número de filas no coincide, ejecuta ROLLBACK; si coincide, COMMIT.
5. El titular vuelve a iniciar sesión. Verifica acceso a Agenda y Consultorios; comprueba que una cuenta DOCTOR continúe sin acceso administrativo. Registra operador, entorno, id y fecha de la promoción sin contraseñas ni tokens.

No ejecutar promociones indiscriminadas por dominio, ni habilitar edición de roles en `/auth/register`. Para revertir una promoción errónea, el operador cambia solo esa cuenta a DOCTOR y limpia su refreshTokenHash: AdminAccessGuard consulta el rol actual en cada petición.

Este procedimiento no se ejecutó al escribir esta documentación ni crea/modifica usuarios automáticamente. La secuencia registro→promoción controlada→nuevo login también existe en `test/audit.e2e-spec.ts`.
