import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ChevronLeft, FileText, User, Cpu, GitCommit, Save, AlertTriangle } from 'lucide-react';

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
  isManual?: boolean;
  autoAttribution?: 'ai' | 'human';
  manualInvalid?: boolean;
}

interface DuplicateStats {
  content: string;
  total_in_file: number;
  ai_count: number;
  estimated_ai_lines: number;
  estimated_human_lines: number;
  confidence: 'low' | 'medium' | 'high';
  note: string;
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
  duplicateStats?: DuplicateStats[];
  warning?: string;
}

interface DiffChange {
  type: 'add' | 'del' | 'normal';
  lineNumber: number;
  content: string;
  isAI: boolean;
  isManual?: boolean;
  autoAttribution?: 'ai' | 'human';
  manualInvalid?: boolean;
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
  const [commits, setCommits] = useState<Commit[]>([]);
  const [fromCommit, setFromCommit] = useState('');
  const [toCommit, setToCommit] = useState('HEAD');
  const [useCommitRange, setUseCommitRange] = useState(false);
  const [manualAttributions, setManualAttributions] = useState<Map<number, 'ai' | 'human'>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (useCommitRange && repoUrl) {
      fetchCommits();
    } else {
      fetchFiles();
    }
  }, [repoUrl, branch, useCommitRange]);

  const fetchCommits = async () => {
    if (!repoUrl) return;
    
    try {
      // 使用 GitHub API
      const decodedRepoUrl = decodeURIComponent(repoUrl);
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
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  };

  const fetchCommitRangeStats = async () => {
    if (!fromCommit) {
      alert('Please select commits!');
      return;
    }
    
    if (!repoUrl) {
      alert('Repository URL is missing!');
      return;
    }

    try {
      setLoading(true);
      // 清除之前的选中文件和详情数据
      setSelectedFile(null);
      setFileAnalysis(null);
      setFileDiff(null);
      
      // 使用 GitHub API
      const decodedRepoUrl = decodeURIComponent(repoUrl!);
      const response = await axios.get('http://localhost:3001/api/github/analyze-commit-range', {
        params: { 
          repo_url: decodedRepoUrl,
          base: fromCommit,
          head: toCommit === 'HEAD' ? decodeURIComponent(branch!) : toCommit
        }
      });
      setFiles(response.data.files);
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
    if (!repoUrl) {
      alert('Repository URL is missing!');
      return;
    }

    // 清空之前的手动标记
    setManualAttributions(new Map());
    setHasUnsavedChanges(false);
    
    setSelectedFile(filePath);
    setAnalyzing(true);
    setFileAnalysis(null);
    setFileDiff(null);

    try {
      const decodedRepoUrl = decodeURIComponent(repoUrl);
      
      if (useCommitRange && fromCommit) {
        // Commit range mode: show diff between commits
        console.log('[FileDetail] Requesting diff:', { fromCommit, toCommit, filePath });
        
        // 使用 GitHub API 获取文件 diff
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
        // Normal mode: show full file attribution
        // 使用 GitHub API 分析文件
        const response = await axios.get<FileAnalysis>(`http://localhost:3001/api/github/analyze-file`, {
          params: {
            repo_url: decodedRepoUrl,
            file_path: filePath,
            branch: decodeURIComponent(branch!)
          }
        });
        setFileAnalysis(response.data);
      }
    } catch (error: any) {
      console.error('Error analyzing file:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      const additionalInfo = 'Please make sure:\n1. The GitHub repository URL is correct\n2. The repository is accessible\n3. The file exists in the repository\n4. GitHub token is configured in .env file';
      alert(`Failed to analyze file:\n\n${errorMsg}\n\n${additionalInfo}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // 切换行的归属标记
  const toggleLineAttribution = (lineNumber: number, currentAttribution: 'ai' | 'human') => {
    const newAttribution = currentAttribution === 'ai' ? 'human' : 'ai';
    setManualAttributions(prev => {
      const updated = new Map(prev);
      updated.set(lineNumber, newAttribution);
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  // 保存手动标记
  const saveManualAttributions = async () => {
    if (!fileAnalysis || manualAttributions.size === 0) return;

    try {
      const decodedRepoUrl = decodeURIComponent(repoUrl!);
      const manualAttrArray = Array.from(manualAttributions.entries()).map(([lineNumber, attribution]) => {
        const line = fileAnalysis.analysis.find(l => l.lineNumber === lineNumber);
        return {
          lineNumber,
          content: line?.content || '',
          attribution
        };
      });

      await axios.post('http://localhost:3001/api/manual-attribution', {
        repo_url: decodedRepoUrl,
        file_path: fileAnalysis.file_path,
        branch: decodeURIComponent(branch!),
        manual_attributions: manualAttrArray
      });

      alert(`已保存 ${manualAttributions.size} 行手动标记`);
      setHasUnsavedChanges(false);
      
      // 重新加载文件以显示最新状态
      if (selectedFile) {
        handleFileClick(selectedFile);
      }
    } catch (error) {
      console.error('Error saving manual attributions:', error);
      alert('保存手动标记失败');
    }
  };

  // 获取有效的归属（考虑手动覆盖）
  const getEffectiveAttribution = (line: LineAttribution): 'ai' | 'human' => {
    if (manualAttributions.has(line.lineNumber)) {
      return manualAttributions.get(line.lineNumber)!;
    }
    return line.attribution === 'ai' ? 'ai' : 'human';
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
        <div className="commit-range-section">
          <label>
            <input
              type="checkbox"
              checked={useCommitRange}
              onChange={(e) => {
                setUseCommitRange(e.target.checked);
                if (e.target.checked && repoUrl) {
                  fetchCommits();
                }
              }}
            />
            <GitCommit size={16} />
            Use commit range analysis
          </label>

          {useCommitRange && (
            <>
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
            </>
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
                      <tr key={index} className={`diff-${change.type} ${change.isAI ? 'ai-code' : ''} ${change.manualInvalid ? 'manual-invalid' : ''}`}>
                        <td className="line-number">
                          {change.lineNumber || ''}
                          {change.manualInvalid && (
                            <span className="invalid-indicator" title="内容已变更，手动标记已失效">⚠</span>
                          )}
                        </td>
                        <td className="line-type">
                          {change.type === 'add' && <span className="diff-marker">+</span>}
                          {change.type === 'del' && <span className="diff-marker">-</span>}
                          {change.type === 'normal' && <span className="diff-marker"> </span>}
                        </td>
                        <td className="line-attribution">
                          {change.isAI && <Cpu size={12} />}
                          {change.isManual && !change.manualInvalid && (
                            <span className="manual-badge" title={`原自动识别: ${change.autoAttribution}`}>
                              M
                            </span>
                          )}
                          {change.manualInvalid && (
                            <span className="invalid-badge" title="手动标记已失效，需要重新标记">
                              失效
                            </span>
                          )}
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
                  {hasUnsavedChanges && (
                    <button 
                      className="save-attributions-btn"
                      onClick={saveManualAttributions}
                      title="保存手动标记"
                    >
                      <Save size={16} />
                      保存标记 ({manualAttributions.size})
                    </button>
                  )}
                </div>
              </div>

              {fileAnalysis.warning && (
                <div className="duplicate-warning">
                  <AlertTriangle size={16} />
                  <div className="warning-content">
                    <strong>检测到重复代码</strong>
                    <p>{fileAnalysis.warning}</p>
                    {fileAnalysis.duplicateStats && fileAnalysis.duplicateStats.length > 0 && (
                      <div className="duplicate-details">
                        {fileAnalysis.duplicateStats.map((stat, idx) => (
                          <details key={idx} className="duplicate-stat-item">
                            <summary>
                              <code>{stat.content.substring(0, 50)}{stat.content.length > 50 ? '...' : ''}</code>
                              <span className="confidence-badge confidence-{stat.confidence}">
                                {stat.confidence === 'low' ? '低' : stat.confidence === 'medium' ? '中' : '高'}置信度
                              </span>
                            </summary>
                            <div className="stat-details">
                              <p><strong>文件中共有：</strong>{stat.total_in_file} 行</p>
                              <p><strong>AI 生成次数：</strong>{stat.ai_count} 次</p>
                              <p><strong>估计 AI 行数：</strong>{stat.estimated_ai_lines}</p>
                              <p><strong>估计人工行数：</strong>{stat.estimated_human_lines}</p>
                              <p className="stat-note">{stat.note}</p>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                    <p className="warning-hint">
                      💡 点击行号可以手动标记该行的归属（AI/人工），然后点击"保存标记"按钮
                    </p>
                  </div>
                </div>
              )}

              <div className="code-view">
                <table className="code-table">
                  <tbody>
                    {fileAnalysis.analysis.map((line) => {
                      const effectiveAttribution = getEffectiveAttribution(line);
                      const isModified = manualAttributions.has(line.lineNumber);
                      const lineClass = effectiveAttribution === 'ai' ? 'line-ai' : 'line-human';
                      
                      return (
                        <tr 
                          key={line.lineNumber} 
                          className={`${lineClass} ${isModified ? 'line-modified-manual' : ''} ${line.isManual ? 'line-saved-manual' : ''}`}
                        >
                          <td 
                            className="line-number clickable" 
                            onClick={() => toggleLineAttribution(line.lineNumber, effectiveAttribution)}
                            title={`点击切换归属 (当前: ${effectiveAttribution === 'ai' ? 'AI' : '人工'}${isModified ? ' - 未保存' : ''}${line.isManual ? ' - 已保存' : ''}${line.manualInvalid ? ' - 标记已失效' : ''})`}
                          >
                            {line.lineNumber}
                            {isModified && <span className="modified-indicator">●</span>}
                            {line.isManual && !line.manualInvalid && <span className="saved-indicator">✓</span>}
                            {line.manualInvalid && <span className="invalid-indicator" title="内容已变更，手动标记已失效">⚠</span>}
                          </td>
                          <td className="line-attribution">
                            {effectiveAttribution === 'ai' && <Cpu size={12} />}
                            {line.attribution === 'ai-modified' && <span>✎</span>}
                            {effectiveAttribution === 'human' && <User size={12} />}
                            {line.isManual && !line.manualInvalid && (
                              <span className="manual-badge" title={`原自动识别: ${line.autoAttribution}`}>
                                M
                              </span>
                            )}
                            {line.manualInvalid && (
                              <span className="invalid-badge" title="手动标记已失效，需要重新标记">
                                失效
                              </span>
                            )}
                          </td>
                          <td className="line-content">
                            <pre>{line.content}</pre>
                          </td>
                        </tr>
                      );
                    })}
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

