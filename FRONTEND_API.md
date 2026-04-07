# API Tasks — guide d’intégration front-end

Base URL : celle de votre déploiement (ex. `https://votre-api.vercel.app`) ou `http://localhost:3000` en local.

Toutes les réponses JSON utilisent `Content-Type: application/json`. Les dates renvoyées par l’API sont en **ISO 8601** (UTC), ex. `2026-12-31T23:59:59.000Z`.

## Modèle d’une tâche

| Champ       | Type    | Description |
|------------|---------|-------------|
| `id`       | string  | Identifiant Firestore (généré côté serveur). |
| `title`    | string  | Titre (1–500 caractères). |
| `completed`| boolean | Terminée ou non. |
| `dueDate`  | string \| null | Date limite d’exécution (ISO 8601), ou `null` si absente. |
| `color`    | string \| null | Couleur hex (`#RGB` ou `#RRGGBB`), ex. `#3b82f6`, ou `null`. |
| `createdAt`| string  | Date de création (ISO 8601). |

Les anciennes tâches sans `dueDate` / `color` renvoient `null` pour ces champs après lecture.

## CORS et en-têtes

- Méthodes autorisées : `GET`, `POST`, `PATCH`, `DELETE`.
- En production, configurez `ALLOWED_ORIGINS` sur le backend (origines séparées par des virgules) pour autoriser l’URL du front.

## Endpoints

### `GET /tasks`

Liste les tâches, triées par `createdAt` décroissant.

**Query (optionnel)**

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `limit`   | 50 (max 100) | Nombre max de tâches. |
| `offset`  | 0 | Pagination (décalage). |

**Réponse `200`**

```json
[
  {
    "id": "abc123",
    "title": "Ma tâche",
    "completed": false,
    "dueDate": "2026-12-31T23:59:59.000Z",
    "color": "#22c55e",
    "createdAt": "2026-04-07T10:00:00.000Z"
  }
]
```

**Exemple (fetch)**

```js
const res = await fetch(`${API_BASE}/tasks?limit=50&offset=0`);
const tasks = await res.json();
```

---

### `POST /tasks`

Crée une tâche.

**Corps JSON**

| Champ     | Obligatoire | Description |
|-----------|-------------|-------------|
| `title`   | oui | Chaîne non vide, max 500 caractères. |
| `dueDate` | non | Chaîne ISO 8601, ou omis / `null` pour aucune échéance. |
| `color`   | non | Hex `#RGB` ou `#RRGGBB`, ou omis / `null` pour aucune couleur stockée. |

**Réponses**

- `201` : tâche créée (corps = objet tâche complet).
- `400` : validation échouée (`{ "error": "..." }`).

**Exemple**

```js
const res = await fetch(`${API_BASE}/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Nouvelle tâche',
    dueDate: '2026-12-31T23:59:59.000Z',
    color: '#3b82f6',
  }),
});
const task = await res.json();
```

---

### `PATCH /tasks/:id`

Met à jour une ou plusieurs propriétés. Envoyez **uniquement** les champs à modifier.

**Champs modifiables**

- `title` (string, 1–500 caractères)
- `completed` (boolean)
- `dueDate` (string ISO 8601 ou `null` pour retirer l’échéance)
- `color` (hex `#RGB` / `#RRGGBB` ou `null` pour retirer la couleur)

**Réponses**

- `200` : tâche mise à jour (corps = objet tâche complet).
- `400` : aucun champ valide, ou valeur invalide.
- `404` : tâche introuvable.

**Exemple — modifier la date limite**

```js
const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dueDate: '2026-06-15T12:00:00.000Z' }),
});
const updated = await res.json();
```

**Exemple — retirer l’échéance**

```js
body: JSON.stringify({ dueDate: null })
```

---

### `DELETE /tasks/:id`

Supprime **une** tâche.

**Réponses**

- `204` : supprimée (pas de corps).
- `404` : introuvable.

```js
await fetch(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' });
```

---

### `POST /tasks/bulk-delete`

Suppression groupée (plusieurs IDs en une requête).

**Corps JSON**

```json
{ "ids": ["id1", "id2", "id3"] }
```

- Tableau non vide, **maximum 100** identifiants.
- Chaque `id` : chaîne non vide, longueur ≤ 100.

**Réponse `200`**

```json
{ "deleted": 3, "ids": ["id1", "id2", "id3"] }
```

**Réponses d’erreur**

- `400` : `ids` manquant, invalide, vide, ou trop d’éléments.

**Exemple (cases à cocher + bouton « Supprimer la sélection »)**

```js
const selectedIds = ['id1', 'id2']; // depuis votre state UI

const res = await fetch(`${API_BASE}/tasks/bulk-delete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: selectedIds }),
});

if (!res.ok) {
  const err = await res.json();
  throw new Error(err.error);
}

const { deleted, ids } = await res.json();
// Mettre à jour la liste locale ou refaire un GET /tasks
```

---

## Vérifier création / mise à jour côté UI

1. Après `POST` ou `PATCH`, utiliser l’objet renvoyé pour mettre à jour l’état (il contient `dueDate` et `color` au format attendu).
2. Ou enchaîner avec `GET /tasks` pour recharger la liste et contrôler l’affichage (date limite, couleur).

## Erreurs HTTP courantes

| Code | Signification |
|------|----------------|
| 400 | Données invalides (message dans `error`). |
| 404 | Route ou tâche introuvable. |
| 429 | Trop de requêtes (rate limiting). |
| 500 | Erreur serveur. |

## Rate limiting

Environ **100 requêtes / 15 minutes / IP** (configurable côté serveur). Prévoir un message utilisateur en cas de `429`.
