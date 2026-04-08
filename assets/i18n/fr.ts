// Fichier de traduction français — source unique pour tous les messages affichés côté frontend
const fr = {
    error: {
        load_day: "Impossible de charger la journée",
        create_entry: "Impossible de créer l'entrée",
        update_entry: "Impossible de mettre à jour l'entrée",
        delete_entry: "Impossible de supprimer l'entrée",
        update_day: "Impossible de mettre à jour la journée",
    },
    timeline: {
        empty_slot: "Ajouter un ticket",
        break_label: "Pause",
        save: "Enregistrer",
        cancel: "Annuler",
        copy: "Copier",
        paste: "Coller",
        clear: "Effacer",
        ticket_placeholder: "PROJ-123",
        comment_placeholder: "Commentaire (optionnel)",
        ticket_required: "ID requis pour enregistrer une saisie",
        ticket_fetch_error: "Ticket introuvable ou inaccessible",
        convert_to_break: "Convertir en pause",
        paste_multiselection_warning: "Pour coller, sélectionne d'abord une seule cellule cible.",
        close: "Fermer",
    },
    navigation: {
        previous_day: "Jour précédent",
        next_day: "Jour suivant",
        today: "Aujourd'hui",
    },
    summary: {
        title: "Récapitulatif",
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
        add_hint: "Ajouter un ticket favori",
        rename_placeholder: "Nom du ticket",
        already_exists: "Ce ticket est déjà dans vos favoris",
        rename_empty: "Le nom ne peut pas être vide",
        empty: "Aucun favori — ajoutez un ticket ci-dessous",
    },
    jira: {
        button: {
            sync: "Sync JIRA",
            syncing: "Synchronisation…",
        },
        status: {
            synced: "Synchronisé à",
            not_synced: "Non synchronisé",
        },
        modal: {
            title: "Synchroniser vers JIRA",
            body: "Les saisies d'heure existantes dans JIRA pour cette journée seront écrasées par vos saisies locales.",
            body_empty: "Aucune saisie à synchroniser. Les saisies d'heure existantes dans JIRA pour cette journée seront supprimées.",
            cancel: "Annuler",
            confirm: "Synchroniser",
        },
        feedback: {
            success: "{n} worklog(s) synchronisé(s) avec succès",
            success_empty: "Saisies JIRA du jour supprimées",
            partial_error: "Synchronisation partielle — certains tickets ont échoué",
        },
        error: {
            sync_failed: "Échec de la synchronisation JIRA",
        },
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
