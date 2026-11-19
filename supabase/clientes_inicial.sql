-- Lista inicial de clientes (de la hoja de papel). Pega en Supabase → SQL Editor → Run.
-- Los nombres repetidos en la hoja llevan "2" para poder distinguirlos: cámbialos desde la app.
insert into public.clientes (nombre) values
  ('PILAR (ENRIC)'), ('MONTSE'), ('DOLORS'), ('PELU'), ('LIDIA'),
  ('SARA (ST. PERE)'), ('MONTSE RIBAS'), ('ARI'), ('JUDITH'), ('OMAR'),
  ('MARIA (PARKINGSOL)'), ('HUBERT'), ('PILAR MAS'), ('ANGELES'), ('LAIA'),
  ('ESTRELLA'), ('EVA'), ('MONTSE ST. POL'), ('MARIA (MESTRES)'), ('MONTSE PUY'),
  ('DOLORS 2'), ('SRA. TERESA'), ('ANA LARGO'), ('NEFER'), ('LIANA'),
  ('ESTHER G.'), ('ALBA'), ('CRISTINA (ROMANI)'), ('JUAN (ESPERANZA)'), ('PATRICIA'),
  ('PEPA'), ('PEDRO'), ('ANITA'), ('LAURA'), ('ITZIAR'),
  ('PAU ZURANO'), ('TERESA VISA'), ('MONICA'), ('ALBERT'), ('ESPERANZA'),
  ('SILVIA'), ('ROSA'), ('MARIBEL'), ('EVA 2'), ('NURIA'),
  ('PATRICIA 2'), ('ROSA (FUTBOL)'), ('ANTONIA'), ('DAVID'), ('JORDI (ROSA)'),
  ('SANDRA'), ('CRISTIAN'), ('ANA (ARENYS)'), ('ROSA 2')
on conflict do nothing;
