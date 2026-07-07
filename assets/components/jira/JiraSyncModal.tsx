import { AlertTriangle } from 'lucide-react';
import { t } from '@/i18n/fr';
import type { WorkDay } from '@/types/api';
import { EntryType } from '@/types/api';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';

interface JiraSyncModalProps {
    open: boolean;
    workDay: WorkDay;
    onConfirm: () => void;
    onCancel: () => void;
}

/** Compte les entrées WORK avec ticket et durée calculable */
function countSyncableEntries(workDay: WorkDay): number {
    return workDay.entries.filter(
        (e) => e.type === EntryType.WORK && null !== e.ticketKey && null !== e.endedAt,
    ).length;
}

export default function JiraSyncModal({ open, workDay, onConfirm, onCancel }: JiraSyncModalProps) {
    const syncableCount = countSyncableEntries(workDay);
    const isEmpty = syncableCount === 0;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                        </div>
                        <DialogTitle>{t('jira.modal.title')}</DialogTitle>
                    </div>
                    <DialogDescription>
                        {isEmpty ? t('jira.modal.body_empty') : t('jira.modal.body')}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        {t('jira.modal.cancel')}
                    </Button>
                    <Button size="sm" onClick={onConfirm}>
                        {t('jira.modal.confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
