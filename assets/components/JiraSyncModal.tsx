import { t } from '../i18n/fr';
import type { WorkDay } from '../types/api';
import { EntryType } from '../types/api';

interface JiraSyncModalProps {
    workDay: WorkDay;
    onConfirm: () => void;
    onCancel: () => void;
}

// Compte les entrées WORK avec ticket et durée calculable
function countSyncableEntries(workDay: WorkDay): number {
    return workDay.entries.filter(
        (e) => e.type === EntryType.WORK && null !== e.ticketKey && null !== e.endedAt,
    ).length;
}

export default function JiraSyncModal({ workDay, onConfirm, onCancel }: JiraSyncModalProps) {
    const syncableCount = countSyncableEntries(workDay);
    const isEmpty = syncableCount === 0;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={onCancel}
        >
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="font-semibold text-gray-900 text-sm">{t('jira.modal.title')}</h2>
                        <p className="mt-1 text-sm text-gray-600">
                            {isEmpty ? t('jira.modal.body_empty') : t('jira.modal.body')}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        {t('jira.modal.cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                        {t('jira.modal.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}