# Motor de configuración flexible (`evaluation_configs`)

Cada fila describe **cómo** se evalúa un proyecto en una **fase** (`sustentation` o `field_contest`) con:

- `method_type`: modalidad lógica (cuestionario, entrevista, fases, concursos por rondas, etc.).
- `scale_min` / `scale_max`: límites numéricos por ítem (validación principal en frontend; opcionalmente en Edge Function o constraint futuro).
- `config` (jsonb): estructura variable según `method_type`.

Las respuestas del jurado viven en `evaluation_answers` con **`item_key`** estable y único por evaluación.

## Convención de `item_key`

| Prefijo | Ejemplo | Uso |
|---------|---------|-----|
| `q:` | `q:a1b2c3d4` | Pregunta de cuestionario (id en config). |
| `iv:` | `iv:open1` | Pregunta de entrevista abierta. |
| `ph:` | `ph:analysis` | Fase de proceso. |
| `rnd:` | `rnd:r2` | Ronda de concurso / prueba de campo. |
| `mod:` | `mod:lab` | Modalidad opcional adicional dentro de concurso. |

## Esquemas sugeridos por `method_type`

### `questionnaire`

```json
{
  "randomPickCount": 5,
  "questions": [
    { "id": "a1b2c3d4", "prompt": "Texto", "maxScore": 5, "requiresObservation": true }
  ]
}
```

- Si `randomPickCount` > 0, el cliente elige aleatoriamente ese subconjunto al iniciar la evaluación y solo genera `item_key` para esas preguntas.

### `interview`

```json
{
  "questions": [
    { "id": "open1", "prompt": "Pregunta abierta", "maxScore": 10, "requiresObservation": true }
  ]
}
```

### `questionnaire_interview`

```json
{
  "questionnaire": { "questions": [ ... ], "randomPickCount": 0 },
  "interview": { "questions": [ ... ] }
}
```

- `item_key`: `q:{id}` e `iv:{id}` según sub-bloque.

### `process_phases`

```json
{
  "phases": [
    { "id": "analysis", "label": "Análisis", "maxScore": 5, "requiresObservation": true }
  ]
}
```

- `item_key`: `ph:{id}`.

### `process_phases_interview`

```json
{
  "phases": [ ... ],
  "interview": { "questions": [ ... ] }
}
```

### `field_rounds`

```json
{
  "rounds": [
    {
      "id": "r1",
      "title": "Ronda 1",
      "description": "Reglas…",
      "maxScore": 20,
      "modalities": [
        { "id": "speed", "label": "Velocidad", "maxScore": 10, "requiresObservation": false }
      ]
    }
  ]
}
```

- Puntaje por ronda: `rnd:{roundId}`.
- Modalidades opcionales: `mod:{roundId}:{modalityId}` (si se califican aparte).

## `total_score` en `evaluations`

- Trigger recalcula `evaluations.total_score` como **suma de `evaluation_answers.score`**.
- La interpretación (por ejemplo normalizar a escala global) puede evolucionar; el MVP asume que los ítems ya están en escala coherente con la config mostrada al jurado.

## Versionado

- `evaluation_configs.version` + `is_active`: al cambiar metodología, desactivar la anterior y crear una nueva fila para conservar historial y no romper evaluaciones previas ligadas por `evaluation_config_id`.
