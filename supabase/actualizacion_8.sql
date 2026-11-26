-- ACTUALIZACIÓN 8: quién se queda el efectivo que cobra en las casas
-- Solo a quien tenga marcada esta casilla se le descuenta lo cobrado de lo que hay que pagarle.
-- Las demás entregan el dinero y no se les descuenta. Es un dato privado (tabla contratos, solo master).
alter table public.contratos add column if not exists se_queda_cobrado boolean not null default false;
