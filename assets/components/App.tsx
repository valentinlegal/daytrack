import { Navigate, Route, Routes } from 'react-router-dom';
import { today } from '@/utils/timeline';
import TimelinePage from './TimelinePage';
import TemplatesPage from './templates/TemplatesPage';

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to={`/${today()}`} replace />} />
            <Route path="/modeles" element={<TemplatesPage />} />
            <Route path="/:date" element={<TimelinePage />} />
        </Routes>
    );
}
