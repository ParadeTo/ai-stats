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
  branch_diff?: {
    base_branch: string;
    ai_lines: number;
    total_added: number;
    ai_ratio: number;
  };
}

type RepoType = 'local' | 'github';

function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBranchDiff, setShowBranchDiff] = useState(true);
  const [repoType, setRepoType] = useState<RepoType>('github');
  const [repoPath, setRepoPath] = useState('');
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

  const fetchBranchDiff = async (project: Project) => {
    if (!repoPath) return;
    
    try {
      if (repoType === 'github') {
        // 使用 GitHub API
        const response = await axios.get('http://localhost:3001/api/github/analyze-commit-range', {
          params: {
            repo_url: repoPath,
            base: 'main', // 默认与 main 分支比较
            head: project.branch_name
          }
        });
        
        return {
          base_branch: 'main',
          ai_lines: response.data.summary.ai_lines,
          total_added: response.data.summary.total_added,
          ai_ratio: response.data.summary.ai_ratio
        };
      } else {
        // 使用本地 Git API
        const response = await axios.get('http://localhost:3001/api/branch-diff-stats', {
          params: {
            repo_path: repoPath,
            branch: project.branch_name
          }
        });
        
        return response.data;
      }
    } catch (error) {
      console.error('Error fetching branch diff:', error);
      return null;
    }
  };

  const loadBranchDiffs = async () => {
    if (!repoPath) {
      const message = repoType === 'github' 
        ? 'Please enter GitHub repository URL first!'
        : 'Please enter local repository path first!';
      alert(message);
      return;
    }

    setLoading(true);
    const updatedProjects = await Promise.all(
      projects.map(async (project) => {
        const diffStats = await fetchBranchDiff(project);
        return { ...project, branch_diff: diffStats };
      })
    );
    setProjects(updatedProjects);
    setLoading(false);
  };

  const getRepoName = (url: string) => {
    const parts = url.split('/');
    return parts[parts.length - 1].replace('.git', '');
  };

  const handleProjectClick = (repo_url: string, branch: string) => {
    navigate(`/project/${encodeURIComponent(repo_url)}/${encodeURIComponent(branch)}`);
  };

  if (loading) return <div className="loading">Loading projects...</div>;

  const displayAiRatio = (project: Project) => {
    if (showBranchDiff && project.branch_diff) {
      return project.branch_diff.ai_ratio;
    }
    return project.ai_ratio;
  };

  const displayAiLines = (project: Project) => {
    if (showBranchDiff && project.branch_diff) {
      return `${project.branch_diff.ai_lines} / ${project.branch_diff.total_added}`;
    }
    return `${project.ai_lines} / ${project.total_lines}`;
  };

  return (
    <div className="project-list-container">
      <header className="page-header">
        <h1>AI Code Statistics</h1>
        <p className="subtitle">Track AI-generated code across your repositories</p>
      </header>

      <div className="controls-section">
        <div className="repo-type-selector" style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#374151' }}>
            Repository Type:
          </label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                value="github"
                checked={repoType === 'github'}
                onChange={(e) => setRepoType(e.target.value as RepoType)}
              />
              GitHub Repository
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                value="local"
                checked={repoType === 'local'}
                onChange={(e) => setRepoType(e.target.value as RepoType)}
              />
              Local Repository
            </label>
          </div>
        </div>
        <div className="repo-path-control">
          <label>
            {repoType === 'github' ? 'GitHub Repository URL' : 'Local Repository Path'} (for branch diff):
          </label>
          <div className="input-group">
            <input
              type="text"
              placeholder={repoType === 'github' 
                ? "https://github.com/owner/repo or owner/repo"
                : "/Users/yourname/projects/repo-name"}
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
            />
            <button onClick={loadBranchDiffs} className="load-btn">
              Load Branch Diffs
            </button>
          </div>
        </div>
        <div className="toggle-control">
          <label>
            <input
              type="checkbox"
              checked={showBranchDiff}
              onChange={(e) => setShowBranchDiff(e.target.checked)}
            />
            Show branch diff vs master/main (instead of all changes)
          </label>
        </div>
      </div>

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
                  {showBranchDiff && project.branch_diff && (
                    <div className="base-branch-info">vs {project.branch_diff.base_branch}</div>
                  )}
                </td>
                <td>{project.user_id}</td>
                <td>
                  <div className="ratio-cell">
                    <div className="ratio-bar-container">
                      <div
                        className="ratio-bar"
                        style={{ width: `${displayAiRatio(project)}%` }}
                      ></div>
                    </div>
                    <span className="ratio-text">{displayAiRatio(project).toFixed(1)}%</span>
                  </div>
                </td>
                <td>
                  <span className="lines-badge">{displayAiLines(project)}</span>
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

