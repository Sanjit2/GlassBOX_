// Get API URL from environment or default to localhost
let defaultApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// Auto-detect if user is accessing the app from another device on the network (e.g. mobile)
if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && defaultApiUrl.includes('localhost')) {
  defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8000/api`;
}

class ApiClient {
  // Initialize the API client with the configured base URL.
  constructor() {
    this.baseUrl = defaultApiUrl;
  }

  /**
   * Get token from secure storage
   * Using localStorage as fallback (consider httpOnly cookies for production)
   */
  getToken() {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('grouphub_token');
    }
    return null;
  }

  /**
   * Make API request with proper headers and error handling
   */
  async request(endpoint, options = {}) {
    try {
      const token = this.getToken();
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const url = `${this.baseUrl}${endpoint}`;
      
      // Validate URL to prevent injection attacks
      if (!this._isValidUrl(url)) {
        throw new Error('Invalid API URL');
      }

      const response = await fetch(url, { 
        ...options, 
        headers,
        credentials: 'omit'  // Don't send cookies since we're using Bearer tokens
      });

      // Handle 401 - Unauthorized (token expired or invalid)
      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('grouphub_token');
          // Redirect to login if not already there
          if (typeof window !== 'undefined' && !['/login', '/register', '/'].includes(window.location.pathname)) {
            window.location.href = '/login';
          }
        }
      }

      // Handle non-ok responses
      if (!response.ok) {
        let error = { detail: 'An error occurred' };
        try {
          error = await response.json();
        } catch (e) {
          error = { detail: `HTTP ${response.status} error` };
        }
        throw new Error(error.detail || 'Request failed');
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null;
      }

      return response.json();
    } catch (error) {
      // Don't log expected auth failures to avoid noisy console
      if (!error.message?.includes('Could not validate')) {
        console.error('API Error:', error);
      }
      throw error;
    }
  }

  /**
   * Validate URL to prevent injection attacks
   */
  _isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      // Only allow http and https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate input string (prevent injection attacks)
   */
  _validateInput(input, fieldName = 'input', maxLength = 255) {
    if (typeof input !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }
    if (input.length > maxLength) {
      throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
    }
    return input.trim();
  }

  // ─── Auth Endpoints ───

  // Create an account through the API, store the token, and update auth state.
  async register(username, email, password) {
    username = this._validateInput(username, 'Username', 50);
    email = this._validateInput(email, 'Email', 100);
    password = this._validateInput(password, 'Password', 128);

    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  // Authenticate with the API, store the token, and update the current user.
  async login(email, password) {
    email = this._validateInput(email, 'Email', 100);
    password = this._validateInput(password, 'Password', 128);

    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  // Fetch the authenticated user profile from the API.
  async getMe() {
    return this.request('/auth/me');
  }

  // ─── Groups Endpoints ───

  // Validate group data and send a group-creation request.
  async createGroup(name, description = '', fields = []) {
    name = this._validateInput(name, 'Group name', 100);
    description = this._validateInput(description, 'Description', 500);
    
    if (!Array.isArray(fields)) {
      throw new Error('Fields must be an array');
    }

    return this.request('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description, fields }),
    });
  }

  // Fetch the groups available to the authenticated user.
  async getGroups() {
    return this.request('/groups');
  }

  // Validate a group code and submit membership profile values.
  async joinGroup(groupCode, profileValues = []) {
    groupCode = this._validateInput(groupCode, 'Group code', 20);
    
    if (!Array.isArray(profileValues)) {
      throw new Error('Profile values must be an array');
    }

    return this.request('/groups/join', {
      method: 'POST',
      body: JSON.stringify({ group_code: groupCode, profile_values: profileValues }),
    });
  }

  // Fetch group details by its code.
  async lookupGroup(code) {
    code = this._validateInput(code, 'Group code', 20);
    return this.request(`/groups/lookup/${encodeURIComponent(code)}`);
  }

  // Fetch one group by its positive numeric ID.
  async getGroup(id) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid group ID');
    }
    return this.request(`/groups/${id}`);
  }

  // Delete a group by its positive numeric ID.
  async deleteGroup(id) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid group ID');
    }
    return this.request(`/groups/${id}`, { method: 'DELETE' });
  }

  // Submit a request for the current user to leave a group.
  async leaveGroup(id) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid group ID');
    }
    return this.request(`/groups/${id}/leave`, { method: 'POST' });
  }

  // ─── Files Endpoints ───

  // Validate file data and create a file in a group.
  async createFile(groupId, filename, language = 'text', content = '', isHidden = false, isReadonly = false) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    filename = this._validateInput(filename, 'Filename', 255);
    language = this._validateInput(language, 'Language', 50);
    // Content can be large, but set a reasonable limit (10MB)
    if (typeof content !== 'string' || content.length > 10 * 1024 * 1024) {
      throw new Error('Content too large (max 10MB)');
    }

    return this.request(`/groups/${groupId}/files`, {
      method: 'POST',
      body: JSON.stringify({ filename, language, content, is_hidden: isHidden, is_readonly: isReadonly }),
    });
  }

  // Fetch all files for a group.
  async getFiles(groupId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    return this.request(`/groups/${groupId}/files`);
  }

  // Fetch one file by group and file IDs.
  async getFile(groupId, fileId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }
    return this.request(`/groups/${groupId}/files/${fileId}`);
  }

  // Update a group file with the supplied data.
  async updateFile(groupId, fileId, data) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }

    return this.request(`/groups/${groupId}/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Delete a selected file and remove it from local state.
  async deleteFile(groupId, fileId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }
    return this.request(`/groups/${groupId}/files/${fileId}`, { method: 'DELETE' });
  }

  // ─── Member File Versions ───

  // Fetch the current user?s version of a file.
  async getMyVersion(groupId, fileId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }
    return this.request(`/groups/${groupId}/files/${fileId}/my-version`);
  }

  // Validate and save the current user?s file content.
  async updateMyVersion(groupId, fileId, content) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }
    if (typeof content !== 'string' || content.length > 10 * 1024 * 1024) {
      throw new Error('Content too large (max 10MB)');
    }

    return this.request(`/groups/${groupId}/files/${fileId}/my-version`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  // Fetch every submitted version of a file.
  async getAllVersions(groupId, fileId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }
    return this.request(`/groups/${groupId}/files/${fileId}/versions`);
  }

  // Fetch a specific member?s version of a file.
  async getMemberVersion(groupId, fileId, userId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error('Invalid file ID');
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('Invalid user ID');
    }
    return this.request(`/groups/${groupId}/files/${fileId}/versions/${userId}`);
  }

  // ─── Code Execution ───

  // Run the group tests and display the execution result.
  async runTests(groupId) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('Invalid group ID');
    }
    // Use a 90s timeout — Docker containers can take up to 60s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
    try {
      return await this.request(`/groups/${groupId}/execute`, {
        method: 'POST',
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Test execution timed out after 90 seconds. The container may be overloaded or hung.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

const api = new ApiClient();
export default api;
