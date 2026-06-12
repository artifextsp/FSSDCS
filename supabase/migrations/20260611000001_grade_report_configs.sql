-- Feria STEAM · Configuración de notas académicas por edición
-- Guarda, por edición, cómo se convierten los puntos a notas académicas:
--   - columns[]: rangos (bandas) por columna (sustentación, funcionalidad, etc.)
--   - total: distribución por porcentajes (tiers) aplicada por proyecto/equipos
-- Lectura pública (para el informe de cada equipo); escritura solo admin.

CREATE TABLE IF NOT EXISTS public.grade_report_configs (
  edition_id uuid PRIMARY KEY REFERENCES public.editions(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grade_report_configs ENABLE ROW LEVEL SECURITY;

-- Lectura para todos (el informe público necesita leer la config de la edición)
CREATE POLICY grade_report_configs_select_all ON public.grade_report_configs
  FOR SELECT USING (true);

-- Escritura solo administradores
CREATE POLICY grade_report_configs_write_admin ON public.grade_report_configs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.grade_report_configs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.grade_report_configs TO authenticated;
