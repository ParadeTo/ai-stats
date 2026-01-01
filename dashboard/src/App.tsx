import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProjectList from './pages/ProjectList';
import FileDetail from './pages/FileDetail';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/project/:repoUrl/:branch" element={<FileDetail />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
