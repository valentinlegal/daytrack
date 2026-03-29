import { Navigate, Route, Routes } from 'react-router-dom';
import { today } from '../utils/timeline';
import TimelinePage from './TimelinePage';

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to={`/${today()}`} replace />} />
            <Route path="/:date" element={<TimelinePage />} />
        </Routes>
    );
}