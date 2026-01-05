import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Github, GitBranch, User, TrendingUp } from 'lucide-react';

interface Project {
  repo_url: string;
  branch_name: string;
  user_id: string;
  ai_lines: number;
  total_lines: number;
  ai_ratio: number;
  last_generation: string;
}

function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await axios.get('http://localhost:3001/api/projects');
      setProjects(response.data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRepoName = (url: string) => {
    const parts = url.split('/');
    return parts[parts.length - 1].replace('.git', '');
  };

  const handleProjectClick = (repo_url: string, branch: string) => {
    navigate(`/project/${encodeURIComponent(repo_url)}/${encodeURIComponent(branch)}`);
  };

  if (loading) return <div className="loading">Loading projects...</div>;

  return (
    <div className="project-list-container">
      <header className="page-header">
        <h1>AI Code Statistics</h1>
        <p className="subtitle">Track AI-generated code across your repositories</p>
      </header>

      <div className="stats-summary">
        <div className="summary-card">
          <div className="summary-value">{projects.length}</div>
          <div className="summary-label">Total Projects</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">
            {projects.reduce((sum, p) => sum + p.ai_lines, 0).toLocaleString()}
          </div>
          <div className="summary-label">AI Lines Generated</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">
            {projects.length > 0
              ? Math.round(
                  (projects.reduce((sum, p) => sum + p.ai_lines, 0) /
                    projects.reduce((sum, p) => sum + p.total_lines, 0)) *
                    100
                )
              : 0}
            %
          </div>
          <div className="summary-label">Avg AI Ratio</div>
        </div>
      </div>

      <div className="projects-table-container">
        <table className="projects-table">
          <thead>
            <tr>
              <th><Github size={16} /> Repository</th>
              <th><GitBranch size={16} /> Branch</th>
              <th><User size={16} /> Author</th>
              <th><TrendingUp size={16} /> AI Code Ratio</th>
              <th>Lines</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, index) => (
              <tr
                key={index}
                onClick={() => handleProjectClick(project.repo_url, project.branch_name)}
                className="project-row"
              >
                <td className="repo-cell">
                  <div className="repo-name">{getRepoName(project.repo_url)}</div>
                  <div className="repo-url">{project.repo_url}</div>
                </td>
                <td>
                  <span className="branch-badge">{project.branch_name}</span>
                </td>
                <td>{project.user_id}</td>
                <td>
                  <div className="ratio-cell">
                    <div className="ratio-bar-container">
                      <div
                        className="ratio-bar"
                        style={{ width: `${project.ai_ratio}%` }}
                      ></div>
                    </div>
                    <span className="ratio-text">{project.ai_ratio.toFixed(1)}%</span>
                  </div>
                </td>
                <td>
                  <span className="lines-badge">{project.ai_lines} / {project.total_lines}</span>
                </td>
                <td className="date-cell">
                  {new Date(project.last_generation).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProjectList;

