/**
 * Middleware to check if user is authenticated via Passport.js
 */
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();

    // Redirect to login for page requests, return 401 for API requests
    if (req.accepts('html') && req.method === 'GET') {
        return res.redirect('/');
    }
    res.status(401).json({ error: 'Unauthorized. Please login.' });
}

module.exports = {
    isAuthenticated
};
