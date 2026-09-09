# re:trouve

> Un espace personnel pour préparer ses recherches de vêtements de seconde main, conserver ses coups de cœur et écarter les résultats qui ne plaisent pas.

[![Site en ligne](https://img.shields.io/badge/site-en%20ligne-315c4b?style=flat-square)](https://feuille2cedric.github.io/retrouve-vinted/)
[![GitHub Pages](https://img.shields.io/badge/déploiement-GitHub%20Pages-ed744e?style=flat-square)](https://github.com/Feuille2Cedric/retrouve-vinted/actions)
[![Projet statique](https://img.shields.io/badge/dépendances-aucune-f2c962?style=flat-square)](#technologies)

## Découvrir le projet

Le site est accessible à cette adresse :

**[feuille2cedric.github.io/retrouve-vinted](https://feuille2cedric.github.io/retrouve-vinted/)**

re:trouve rassemble sur une seule interface les critères utiles pour chercher un article : type de vêtement, marque, modèle, taille, couleur, budget, marché et réputation du vendeur. L'expérience est personnalisable et les préférences restent enregistrées dans le navigateur.

## Fonctionnalités

- profil local avec prénom personnalisable ;
- recherche par type, marque, modèle, taille, couleur et prix maximum ;
- sélection du marché Vinted ;
- note minimale du vendeur ;
- possibilité d'inclure ou d'exclure les vendeurs sans évaluation ;
- tri par pertinence, date ou prix ;
- favoris persistants ;
- annonces écartées avec restauration individuelle ou complète ;
- import d'une photo de référence ;
- analyse visuelle facultative avec MobileNet ;
- affichage responsive pour ordinateur, tablette et mobile ;
- déploiement automatique avec GitHub Pages.

## Modes de résultats

### Google Programmable Search

Cette solution sans backend affiche directement dans la page les annonces Vinted indexées par Google.

Les cartes sont construites à partir des données du résultat Google : photo principale issue des métadonnées de l’annonce, titre, description disponible et lien vers le même identifiant Vinted. Les favoris et les exclusions restent enregistrés après rechargement.

1. Créer un moteur sur [Google Programmable Search](https://programmablesearchengine.google.com/controlpanel/create).
2. Ajouter `www.vinted.fr/items/*` dans **Sites à rechercher**.
3. Ajouter de la même manière les autres marchés souhaités, par exemple `www.vinted.be/items/*`.
4. Copier l'identifiant du moteur (`cx`).
5. Sur re:trouve, cliquer sur **Configurer** et coller cet identifiant.

L'identifiant est mémorisé dans le navigateur. Le site accepte aussi bien l'identifiant seul que le bloc `<script>` fourni par Google.

Le moteur du projet est préconfiguré dans `config.js`. La recherche d’images Google n’est pas nécessaire : les photos proviennent des métadonnées des résultats web.

> Google Programmable Search dépend de son index, pas du catalogue Vinted en direct. Le budget et la disponibilité ne peuvent pas être garantis. Les évaluations des vendeurs et le tri par date sont désactivés dans ce mode.

Le filtre **Avec photo uniquement** est activé par défaut. Décochez-le pour voir également les annonces sans photo disponible. Les tailles connues qui contredisent la recherche sont exclues. Un prix absent reste indiqué « Prix sur Vinted » : les prix et tailles des articles recommandés dans les extraits Google ne sont jamais attribués à l’annonce. Le tri par prix concerne seulement les prix fournis et reste désactivé lorsqu’aucun prix n’est connu.

Écarter une annonce dans les trouvailles la remplace automatiquement, sans recharger la page. Les cartes conservées restent affichées. L’application utilise d’abord les résultats déjà chargés, puis demande la page Google suivante de façon asynchrone. Les doublons et les annonces écartées sont exclus. Les clics rapprochés sont regroupés ; le chargement s’arrête après trois pages sans remplacement suffisant, à la fin des résultats ou si Google ne répond pas. Écarter un favori ne charge pas de nouvelles annonces dans les favoris.

Google peut demander une vérification anti-robot ou refuser temporairement des recherches. La vérification reste visible dans la page. Pour un catalogue à jour avec prix, stocks et filtres garantis, une source API fournissant ces données est nécessaire.

La photo et le bouton « Voir l’annonce » ouvrent l’URL de l’annonce indexée, sans la remplacer par une recherche générale. Si l’annonce a expiré, Vinted peut afficher une page indisponible.

### API personnalisée

Pour utiliser une source d'annonces autorisée, renseigner son adresse publique dans [`config.js`](config.js) :

```js
window.RETROUVE_CONFIG = {
  apiUrl: 'https://api.example.com/search',
  googleSearchEngineId: '',
};
```

Le navigateur envoie les paramètres suivants lorsqu'ils sont renseignés :

| Paramètre | Description | Exemple |
| --- | --- | --- |
| `type` | Type de pièce | `Baskets` |
| `brand` | Marque | `Nike` |
| `details` | Modèle ou mots-clés | `Air Max 90` |
| `size` | Taille | `38` |
| `maxPrice` | Prix maximum | `80` |
| `color` | Couleur | `blanc` |
| `minRating` | Note vendeur minimale | `4.5` |
| `allowUnrated` | Autoriser les vendeurs sans avis | `true` |
| `market` | Marché sélectionné | `fr` |

Format de réponse attendu :

```json
{
  "items": [
    {
      "id": "123",
      "title": "Air Max 90",
      "brand": "Nike",
      "size": "38",
      "price": 54,
      "country": "France",
      "condition": "Très bon état",
      "sellerRating": 4.9,
      "reviewCount": 47,
      "image": "https://example.com/image.jpg",
      "url": "https://example.com/annonce/123",
      "createdAt": 1720000000
    }
  ]
}
```

L'API doit autoriser le domaine GitHub Pages avec CORS. Les clés secrètes doivent rester côté serveur et ne jamais apparaître dans `config.js`.

## Lancer le site en local

Le projet ne demande aucune installation.

```bash
git clone https://github.com/Feuille2Cedric/retrouve-vinted.git
cd retrouve-vinted
python -m http.server 8080
```

Ouvrir ensuite [localhost:8080](http://localhost:8080).

## Technologies

- HTML5 sémantique ;
- CSS responsive sans framework ;
- JavaScript natif ;
- `localStorage` pour les préférences ;
- TensorFlow.js et MobileNet chargés uniquement à la demande ;
- Google Programmable Search pour le mode intégré ;
- GitHub Actions et GitHub Pages pour le déploiement.

## Vérification des résultats

Après avoir lancé le serveur local, ouvrir `/tests/search-results.html`. Les tests utilisent un extrait de réponse réelle du moteur pour vérifier les liens Google, l’association photo/article, les métadonnées absentes et les prix ou tailles provenant d’articles recommandés.

`/tests/refill.html` vérifie le remplacement avec des réponses asynchrones simulées : conservation des cartes, réserve de résultats, clics rapprochés, doublons, fin de pagination, annulation et réponse tardive. Ces tests ne sollicitent pas Google.

La conversion des données est isolée dans `search-results.js`. Le rendu utilise le callback `ready` de [Google Programmable Search](https://developers.google.com/custom-search/docs/element), sans réécrire continuellement les cartes natives avec un observateur DOM.

## Structure

```text
.
├── .github/workflows/pages.yml  # Déploiement GitHub Pages
├── app.js                       # Recherche et interactions
├── config.js                    # Sources de résultats
├── favicon.svg                  # Icône du site
├── index.html                   # Interface
├── styles.css                   # Design responsive
├── PROMPTS.md                   # Historique des demandes
└── README.md                    # Documentation
```

## Confidentialité

- Le prénom, les favoris et les exclusions restent dans le navigateur.
- La photo importée n'est pas envoyée vers le projet re:trouve.
- L'analyse MobileNet est exécutée dans le navigateur après le chargement du modèle.
- Aucune clé secrète n'est incluse dans le dépôt.

## Limites et statut

re:trouve est un projet indépendant, sans affiliation ni approbation de Vinted. Le projet ne tente pas de contourner les protections de la plateforme. L'affichage d'annonces réelles dépend d'une source autorisée ou des pages déjà indexées par Google.

## Historique de conception

Les demandes ayant guidé la création et les itérations du projet sont regroupées dans [`PROMPTS.md`](PROMPTS.md).
