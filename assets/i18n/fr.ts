// Fichier de traduction français — source unique pour tous les messages affichés côté frontend
const fr = {
    app: {
        name: "DayTrack",
    },
    error: {
        load_day: "Impossible de charger la journée",
        create_entry: "Impossible de créer l'entrée",
        update_entry: "Impossible de mettre à jour l'entrée",
        delete_entry: "Impossible de supprimer l'entrée",
        update_day: "Impossible de mettre à jour la journée",
    },
    common: {
        loading: "Chargement…",
        close: "Fermer",
    },
    timeline: {
        empty_slot: "Ajouter un ticket",
        break_label: "Pause",
        save: "Enregistrer",
        cancel: "Annuler",
        copy: "Copier",
        cut: "Couper",
        paste: "Coller",
        clear: "Effacer",
        ticket_placeholder: "PROJ-123",
        comment_placeholder: "Commentaire (optionnel)",
        ticket_required: "ID requis pour enregistrer une saisie",
        ticket_fetch_error: "Ticket introuvable ou inaccessible",
        convert_to_break: "Convertir en pause",
        paste_multiselection_warning: "Pour coller, sélectionnez d'abord une seule cellule cible.",
        close: "Fermer",
    },
    navigation: {
        previous_day: "Jour précédent",
        next_day: "Jour suivant",
        today: "Aujourd'hui",
    },
    header: {
        worked: "Travaillé",
        target: "Objectif",
        balance: "Solde",
        estimated_end: "Fin",
        target_edit_hint: "Modifier l'objectif",
        report: "Rapport",
    },
    summary: {
        title: "Récapitulatif",
        empty: "Aucune saisie pour cette journée.",
        worked: "Travaillé",
        target: "Objectif",
        balance: "Solde",
        estimated_end: "Fin estimée",
        target_edit_hint: "Cliquer pour modifier l'objectif",
        tickets_title: "Tickets",
        no_comment: "(sans commentaire)",
    },
    favorites: {
        title: "Favoris",
        copy_tooltip: "Cliquer pour copier",
        copied: "Copié !",
        add_placeholder: "PROJ-123",
        add_hint: "Ajouter un favori",
        add_title: "Nouveau favori",
        rename_placeholder: "Nom du ticket",
        already_exists: "Ce ticket est déjà dans vos favoris",
        rename_empty: "Le nom ne peut pas être vide",
        empty: "Aucun favori",
    },
    templates: {
        nav: "Modèles",
        banner: "Semaine type — s'applique aux futurs jours vides",
        back_to_day: "Retour au jour",
        loading: "Chargement des modèles…",
        weekday: {
            "1": "Lundi",
            "2": "Mardi",
            "3": "Mercredi",
            "4": "Jeudi",
            "5": "Vendredi",
            "6": "Samedi",
            "7": "Dimanche",
        },
        target: {
            hint: "Objectif du jour — vide = 7h30 par défaut",
            invalid: "Format invalide (ex : 6h30)",
        },
        block: {
            edit: "Éditer le ticket",
            convert_to_break: "Convertir en pause",
            convert_to_work: "Convertir en travail",
            disable: "Désactiver la règle",
            enable: "Activer la règle",
            delete: "Supprimer la règle",
            disabled_badge: "Désactivée",
        },
        recurrence: {
            menu: "Récurrence",
            every_week: "Toutes les semaines",
            every_n_weeks: "Une semaine sur {n}",
            set_end_date: "Ajouter une date de fin…",
            clear_end_date: "Retirer la date de fin",
            end_date_title: "Dernière semaine d'application",
            end_date_confirm: "Appliquer",
            cadence_tooltip: "Une semaine sur {n} — bloc {pos}/{size}",
        },
        stack: {
            title: "Ce créneau est déjà occupé",
            replace: "Remplacer le bloc existant",
            alternate: "Alterner une semaine sur deux",
            cancel: "Annuler",
            rotation_exists: "Ce créneau contient déjà une alternance. Supprimez d'abord l'un des deux blocs.",
            start_date_title: "À partir de quelle semaine démarre l'alternance ?",
            start_date_hint: "Jamais dans le passé — aujourd'hui par défaut.",
            confirm_alternate: "Créer l'alternance",
        },
        error: {
            load: "Impossible de charger les modèles",
            save: "Impossible d'enregistrer la règle",
            delete: "Impossible de supprimer la règle",
        },
    },
    jira: {
        button: {
            sync: "Synchroniser vers Jira",
            syncing: "Synchronisation…",
        },
        status: {
            synced: "Synchronisé à",
            not_synced: "Non synchronisé",
            dirty: "Modifié depuis la dernière sync — cliquer pour re-synchroniser",
            nothing_to_sync: "Aucune saisie à synchroniser",
            synced_cleanup: "Synchroniser pour effacer les saisies Jira du jour",
        },
        modal: {
            title: "Synchroniser vers Jira",
            body: "Les saisies d'heure existantes dans Jira pour cette journée seront écrasées par vos saisies locales.",
            body_empty: "Aucune saisie à synchroniser. Les saisies d'heure existantes dans Jira pour cette journée seront supprimées.",
            cancel: "Annuler",
            confirm: "Synchroniser",
        },
        feedback: {
            success: "{n} worklog(s) synchronisé(s) avec succès",
            success_empty: "Saisies Jira du jour supprimées",
            partial_error: "Synchronisation partielle — certains tickets ont échoué",
            synced: "Synchronisé !",
        },
        error: {
            sync_failed: "Échec de la synchronisation Jira",
        },
    },
    update: {
        available: "Nouvelle version disponible",
        current_to_latest: "{current} → {latest}",
        how_to: "Pour mettre à jour, exécutez dans le dossier du projet :",
        copy: "Copier",
        copied: "Copié !",
    },
} as const;

export type TranslationKey = string;

// Résout une clé pointée (ex: "error.load_day") dans l'objet de traductions
export function t(key: string): string {
    const parts = key.split('.');
    let current: unknown = fr;

    for (const part of parts) {
        if (typeof current !== 'object' || current === null) return key;
        current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'string' ? current : key;
}
