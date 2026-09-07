# re:trouve

Un tableau de bord personnel pour rechercher, trier, garder et écarter des annonces de seconde main.

## Ce qui fonctionne immédiatement

- profil local avec prénom personnalisable ;
- recherche par type, marque, modèle, taille, couleur, budget et marché ;
- note vendeur minimale et choix d'accepter ou non les vendeurs sans évaluation ;
- grille d'annonces intégrée en mode aperçu ;
- favoris et annonces écartées conservés dans `localStorage` ;
- restauration individuelle ou complète des annonces écartées ;
- tri par pertinence, date ou prix ;
- import de photo et analyse MobileNet facultative dans le navigateur ;
- interface responsive, sans installation, compatible GitHub Pages.

## Pourquoi le site démarre en « mode aperçu »

Vinted ne fournit pas d'API publique de recherche destinée à ce type d'application. GitHub Pages est par ailleurs un hébergement statique : il ne peut ni protéger une clé secrète ni exécuter un serveur.

Le site n'essaie donc pas de contourner les protections de Vinted. Les cartes fournies permettent de tester toute l'expérience. Leur bouton ouvre une recherche équivalente sur Vinted ; elles ne sont pas présentées comme de vraies annonces en direct.

Sans source connectée, le bouton principal ouvre uniquement la configuration dans re:trouve. Aucune page Vinted n'est lancée automatiquement. Une page Vinted s'ouvre seulement lorsque l'utilisateur choisit volontairement de consulter une annonce.

## Connecter une source d'annonces autorisée

### Option sans backend : Google Programmable Search

Cette option affiche sur la page les annonces Vinted déjà indexées par Google :

1. Ouvrir `https://programmablesearchengine.google.com/controlpanel/create`.
2. Créer un moteur et ajouter `www.vinted.fr/items/*` dans **Sites à rechercher**. Ajouter les autres domaines Vinted souhaités de la même manière.
3. Copier l'identifiant du moteur de recherche (`cx`).
4. Sur re:trouve, ouvrir le bouton `?` du bandeau jaune et coller cet identifiant.

Le moteur est mémorisé dans le navigateur. Les résultats apparaissent ensuite directement dans la page et chacun peut être écarté avec le bouton `×`.

Cette méthode dépend des pages indexées par Google. Elle ne fournit pas la note du vendeur et peut ne pas contenir les annonces les plus récentes.

### Option API personnalisée

Renseigner l'URL publique d'un intermédiaire API dans `config.js` :

```js
window.RETROUVE_CONFIG = {
  apiUrl: 'https://api.example.com/search',
};
```

Le navigateur lui transmet les paramètres non vides suivants dans l'URL :

- `type`
- `brand`
- `details`
- `size`
- `maxPrice`
- `color`
- `minRating`
- `allowUnrated` (`true` ou `false`)
- `market`

Réponse JSON attendue :

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

L'API doit autoriser le domaine GitHub Pages avec CORS. Une éventuelle clé fournisseur doit rester côté serveur et ne jamais être ajoutée à `config.js`.

## Lancer en local

```bash
python -m http.server 8080
```

Ouvrir ensuite `http://localhost:8080`.

## Déployer sur GitHub Pages

1. Créer un dépôt GitHub et y placer le contenu de ce dossier.
2. Dans **Settings → Pages**, choisir **GitHub Actions**.
3. Pousser la branche `main`.

Le workflow `.github/workflows/pages.yml` publie automatiquement le site.

## Note

re:trouve est un projet indépendant, sans affiliation avec Vinted.
