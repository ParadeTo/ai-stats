import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ChevronLeft, FileText, User, Cpu, GitCommit } from 'lucide-react';

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

interface FileSummary {
  file_path: string;
  ai_lines: number;
  manual_lines?: number;
  added_lines?: number;
  deleted_lines?: number;
  unchanged_lines?: number;
  total_lines?: number;
  ai_ratio: number;
}

interface LineAttribution {
  lineNumber: number;
  content: string;
  attribution: 'ai' | 'ai-modified' | 'human';
  generation_id: string | null;
}

interface FileAnalysis {
  file_path: string;
  stats: {
    total_lines: number;
    ai_lines: number;
    modified_lines: number;
    human_lines: number;
  };
  analysis: LineAttribution[];
}

interface DiffChange {
  type: 'add' | 'del' | 'normal';
  lineNumber: number;
  content: string;
  isAI: boolean;
}

interface FileDiff {
  file_path: string;
  from_commit: string;
  to_commit: string;
  changes: DiffChange[];
  stats: {
    added: number;
    deleted: number;
    ai_added: number;
    ai_deleted: number;
  };
}

type RepoType = 'local' | 'github';

interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

function FileDetail() {
  const { repoUrl, branch } = useParams<{ repoUrl: string; branch: string }>();
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileAnalysis, setFileAnalysis] = useState<FileAnalysis | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [repoType, setRepoType] = useState<RepoType>('github');
  const [repoPath, setRepoPath] = useState('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [fromCommit, setFromCommit] = useState('');
  const [toCommit, setToCommit] = useState('HEAD');
  const [useCommitRange, setUseCommitRange] = useState(false);
  const navigate = useNavigate();

  // 当切换到 GitHub 模式时，自动填充 repoUrl
  useEffect(() => {
    if (repoType === 'github' && repoUrl && !repoPath) {
      setRepoPath(decodeURIComponent(repoUrl));
    }
  }, [repoType, repoUrl]);

  useEffect(() => {
    if (useCommitRange && (repoPath || repoType === 'github')) {
      fetchCommits();
    } else {
      fetchFiles();
    }
  }, [repoUrl, branch, useCommitRange, repoType]);

  const fetchCommits = async () => {
    if (repoType === 'github' && !repoUrl) return;
    if (repoType === 'local' && !repoPath) return;
    
    try {
      if (repoType === 'github') {
        // 使用 GitHub API
        const decodedRepoUrl = repoPath || decodeURIComponent(repoUrl!);
        const response = await axios.get<{ commits: GitHubCommit[] }>('http://localhost:3001/api/github/commits', {
          params: { 
            repo_url: decodedRepoUrl,
            branch: decodeURIComponent(branch!),
            per_page: 100
          }
        });
        
        const formattedCommits: Commit[] = response.data.commits.map(c => ({
          hash: c.sha,
          shortHash: c.sha.substring(0, 7),
          author: c.author,
          date: c.date,
          message: c.message
        }));
        
        setCommits(formattedCommits);
        if (formattedCommits.length > 0) {
          setToCommit('HEAD');
          if (formattedCommits.length > 1) {
            setFromCommit(formattedCommits[Math.min(10, formattedCommits.length - 1)].hash);
          }
        }
      } else {
        // 使用本地 Git API
        const response = await axios.get('http://localhost:3001/api/commits', {
          params: { repo_path: repoPath, branch, limit: 100 }
        });
        setCommits(response.data);
        if (response.data.length > 0) {
          setToCommit('HEAD');
          if (response.data.length > 1) {
            setFromCommit(response.data[Math.min(10, response.data.length - 1)].hash);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  };

  const fetchCommitRangeStats = async () => {
    if (!fromCommit) {
      alert('Please select commits!');
      return;
    }
    
    if (repoType === 'github' && !repoPath && !repoUrl) {
      alert('Please enter GitHub repository URL!');
      return;
    }
    
    if (repoType === 'local' && !repoPath) {
      alert('Please enter local repository path!');
      return;
    }

    try {
      setLoading(true);
      // 清除之前的选中文件和详情数据
      setSelectedFile(null);
      setFileAnalysis(null);
      setFileDiff(null);
      
      if (repoType === 'github') {
        // 使用 GitHub API
        const decodedRepoUrl = repoPath || decodeURIComponent(repoUrl!);
        const response = await axios.get('http://localhost:3001/api/github/analyze-commit-range', {
          params: { 
            repo_url: decodedRepoUrl,
            base: fromCommit,
            head: toCommit === 'HEAD' ? decodeURIComponent(branch!) : toCommit
          }
        });
        setFiles(response.data.files);
      } else {
        // 使用本地 Git API
        const response = await axios.get('http://localhost:3001/api/commit-range-stats', {
          params: { repo_path: repoPath, from_commit: fromCommit, to_commit: toCommit }
        });
        setFiles(response.data.files);
      }
    } catch (error) {
      console.error('Error fetching commit range stats:', error);
      alert('Failed to fetch commit range statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [repoUrl, branch]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`http://localhost:3001/api/project-files`, {
        params: { repo_url: decodeURIComponent(repoUrl!), branch: decodeURIComponent(branch!) }
      });
      setFiles(response.data);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = async (filePath: string) => {
    if (repoType === 'github' && !repoPath && !repoUrl) {
      alert('Please enter the GitHub repository URL first!');
      return;
    }
    
    if (repoType === 'local' && !repoPath) {
      alert('Please enter the local repository path first!');
      return;
    }

    setSelectedFile(filePath);
    setAnalyzing(true);
    setFileAnalysis(null);
    setFileDiff(null);

    try {
      if (useCommitRange && fromCommit) {
        // Commit range mode: show diff between commits
        console.log('[FileDetail] Requesting diff:', { fromCommit, toCommit, filePath });
        
        if (repoType === 'github') {
          // 使用 GitHub API 获取文件 diff
          const decodedRepoUrl = repoPath || decodeURIComponent(repoUrl!);
          const response = await axios.get<FileDiff>(`http://localhost:3001/api/github/commit-range-file-diff`, {
            params: {
              repo_url: decodedRepoUrl,
              file_path: filePath,
              from_commit: fromCommit,
              to_commit: toCommit === 'HEAD' ? decodeURIComponent(branch!) : toCommit
            }
          });
          console.log('[FileDetail] Received diff:', response.data);
          setFileDiff(response.data);
        } else {
          // 使用本地 Git API
          const response = await axios.get<FileDiff>(`http://localhost:3001/api/commit-range-file-diff`, {
            params: {
              repo_path: repoPath,
              file_path: filePath,
              from_commit: fromCommit,
              to_commit: toCommit
            }
          });
          console.log('[FileDetail] Received diff:', response.data);
          setFileDiff(response.data);
        }
      } else {
        // Normal mode: show full file attribution
        if (repoType === 'github') {
          // 使用 GitHub API 分析文件
          const decodedRepoUrl = repoPath || decodeURIComponent(repoUrl!);
          const response = await axios.get<FileAnalysis>(`http://localhost:3001/api/github/analyze-file`, {
            params: {
              repo_url: decodedRepoUrl,
              file_path: filePath,
              branch: decodeURIComponent(branch!)
            }
          });
          setFileAnalysis(response.data);
        } else {
          // 使用本地 Git API
          const response = await axios.get<FileAnalysis>(`http://localhost:3001/api/analyze-file`, {
            params: {
              repo_path: repoPath,
              file_path: filePath
            }
          });
          setFileAnalysis(response.data);
        }
      }
    } catch (error: any) {
      console.error('Error analyzing file:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      const additionalInfo = repoType === 'github'
        ? 'Please make sure:\n1. The GitHub repository URL is correct\n2. The repository is accessible\n3. The file exists in the repository\n4. GitHub token is configured in .env file'
        : 'Please make sure:\n1. The repo path is a valid absolute path\n2. The path points to a git repository\n3. The file exists in the repository';
      alert(`Failed to analyze file:\n\n${errorMsg}\n\n${additionalInfo}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const getLineClass = (attribution: string) => {
    switch (attribution) {
      case 'ai':
        return 'line-ai';
      case 'ai-modified':
        return 'line-ai-modified';
      case 'human':
        return 'line-human';
      default:
        return '';
    }
  };

  if (loading) return <div className="loading">Loading file details...</div>;

  return (
    <div className="file-detail-container">
      <header className="detail-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <ChevronLeft size={20} /> Back to Projects
        </button>
        <h1>{decodeURIComponent(repoUrl!).split('/').pop()?.replace('.git', '')}</h1>
        <span className="branch-badge">{decodeURIComponent(branch!)}</span>
      </header>

      <div className="config-section">
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
                onChange={(e) => {
                  setRepoType(e.target.value as RepoType);
                  // 如果是 GitHub，自动填充 repoUrl
                  if (e.target.value === 'github' && repoUrl) {
                    setRepoPath(decodeURIComponent(repoUrl));
                  }
                }}
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
        <div className="repo-path-input">
          <label>
            {repoType === 'github' ? 'GitHub Repository URL' : 'Local Repository Path'}:
          </label>
          <input
            type="text"
            placeholder={repoType === 'github'
              ? "https://github.com/owner/repo or owner/repo"
              : "/Users/yourname/projects/repo-name"}
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
          />
        </div>

        <div className="commit-range-section">
          <label>
            <input
              type="checkbox"
              checked={useCommitRange}
              onChange={(e) => {
                setUseCommitRange(e.target.checked);
                if (e.target.checked && (repoPath || (repoType === 'github' && repoUrl))) {
                  fetchCommits();
                }
              }}
            />
            <GitCommit size={16} />
            Use commit range analysis
          </label>

          {useCommitRange && (
            <div className="commit-selectors">
              <div className="commit-selector">
                <label>From Commit:</label>
                <select value={fromCommit} onChange={(e) => setFromCommit(e.target.value)}>
                  <option value="">Select commit...</option>
                  {commits.map((commit) => (
                    <option key={commit.hash} value={commit.hash}>
                      {commit.shortHash} - {commit.message.substring(0, 50)} ({commit.author})
                    </option>
                  ))}
                </select>
              </div>

              <div className="commit-selector">
                <label>To Commit:</label>
                <select value={toCommit} onChange={(e) => setToCommit(e.target.value)}>
                  <option value="HEAD">HEAD (current)</option>
                  {commits.map((commit) => (
                    <option key={commit.hash} value={commit.hash}>
                      {commit.shortHash} - {commit.message.substring(0, 50)} ({commit.author})
                    </option>
                  ))}
                </select>
              </div>

              <button onClick={fetchCommitRangeStats} className="analyze-btn">
                Analyze Range
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="file-explorer">
        <div className="files-sidebar">
          <h3><FileText size={18} /> Changed Files {files.length > 0 && `(${files.length})`}</h3>
          <div className="file-list">
            {files.map((file, index) => (
              <div
                key={index}
                className={`file-item ${selectedFile === file.file_path ? 'active' : ''}`}
                onClick={() => handleFileClick(file.file_path)}
              >
                <div className="file-name">{file.file_path}</div>
                <div className="file-stats">
                  <span className="stat-ai">AI: {file.ai_lines}</span>
                  {file.added_lines !== undefined && (
                    <span className="stat-added">+{file.added_lines}</span>
                  )}
                  {file.manual_lines !== undefined && (
                    <span className="stat-human">±{file.manual_lines}</span>
                  )}
                  {file.deleted_lines !== undefined && (
                    <span className="stat-deleted">-{file.deleted_lines}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="file-content">
          {!selectedFile && (
            <div className="empty-state">
              <FileText size={48} />
              <p>Select a file to view line-by-line attribution</p>
            </div>
          )}

          {selectedFile && !analyzing && fileDiff && (
            <>
              <div className="file-header">
                <div className="file-path">{fileDiff.file_path}</div>
                <div className="commit-range-info">
                  Diff: {fileDiff.from_commit.substring(0, 7)}...{fileDiff.to_commit === 'HEAD' ? 'HEAD' : fileDiff.to_commit.substring(0, 7)}
                </div>
                <div className="file-summary">
                  <div className="summary-item stat-added">
                    +{fileDiff.stats.added} (AI: {fileDiff.stats.ai_added})
                  </div>
                  <div className="summary-item stat-deleted">
                    -{fileDiff.stats.deleted} (AI: {fileDiff.stats.ai_deleted})
                  </div>
                  <div className="ratio-badge">
                    {fileDiff.stats.added > 0 
                      ? Math.round((fileDiff.stats.ai_added / fileDiff.stats.added) * 100)
                      : 0}% AI
                  </div>
                </div>
              </div>

              <div className="code-view">
                <table className="code-table">
                  <tbody>
                    {fileDiff.changes.map((change, index) => (
                      <tr key={index} className={`diff-${change.type} ${change.isAI ? 'ai-code' : ''}`}>
                        <td className="line-number">{change.lineNumber || ''}</td>
                        <td className="line-type">
                          {change.type === 'add' && <span className="diff-marker">+</span>}
                          {change.type === 'del' && <span className="diff-marker">-</span>}
                          {change.type === 'normal' && <span className="diff-marker"> </span>}
                        </td>
                        <td className="line-attribution">
                          {change.isAI && <Cpu size={12} />}
                        </td>
                        <td className="line-content">
                          <pre>{change.content}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {selectedFile && !analyzing && fileAnalysis && (
            <>
              <div className="file-header">
                <div className="file-path">{fileAnalysis.file_path}</div>
                <div className="file-summary">
                  <div className="summary-item">
                    <Cpu size={16} color="#10b981" />
                    <span>AI: {fileAnalysis.stats.ai_lines}</span>
                  </div>
                  <div className="summary-item">
                    <User size={16} color="#f59e0b" />
                    <span>Manual: {fileAnalysis.stats.human_lines}</span>
                  </div>
                  <div className="summary-item">
                    <span>Modified: {fileAnalysis.stats.modified_lines}</span>
                  </div>
                  <div className="ratio-badge">
                    {Math.round((fileAnalysis.stats.ai_lines / fileAnalysis.stats.total_lines) * 100)}% AI
                  </div>
                </div>
              </div>

              <div className="code-view">
                <table className="code-table">
                  <tbody>
                    {fileAnalysis.analysis.map((line) => (
                      <tr key={line.lineNumber} className={getLineClass(line.attribution)}>
                        <td className="line-number">{line.lineNumber}</td>
                        <td className="line-attribution">
                          {line.attribution === 'ai' && <Cpu size={12} />}
                          {line.attribution === 'ai-modified' && <span>✎</span>}
                          {line.attribution === 'human' && <User size={12} />}
                        </td>
                        <td className="line-content">
                          <pre>{line.content}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {analyzing && (
            <div className="analyzing-state">
              <div className="spinner"></div>
              <p>Analyzing {selectedFile}...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FileDetail;

