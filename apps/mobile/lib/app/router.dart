import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../screens/home_screen.dart';
import '../screens/scanner_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/terminal_screen.dart';

/// Route observer for detecting when user returns to a route (e.g. HomeScreen).
/// Used to auto-refresh session list when navigating back from terminal/scan/settings.
final routeObserver = RouteObserver<ModalRoute<void>>();

// Named route constants to avoid magic strings throughout the app.
class AppRoutes {
  static const home = '/';
  static const scan = '/scan';
  static const terminal = '/terminal';
  static const settings = '/settings';
}

final routerProvider = Provider<GoRouter>((ref) {
  // Use a listenable that notifies the router when connection state changes
  // so it can re-evaluate redirect logic.
  final connectionListenable = _ConnectionStateListenable(ref);

  return GoRouter(
    initialLocation: AppRoutes.home,
    refreshListenable: connectionListenable,
    observers: [routeObserver],
    debugLogDiagnostics: false,
    routes: [
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        pageBuilder: (context, state) =>
            _buildPage(state: state, child: const HomeScreen()),
      ),
      GoRoute(
        path: AppRoutes.scan,
        name: 'scan',
        pageBuilder: (context, state) =>
            _buildPage(state: state, child: const ScannerScreen()),
      ),
      GoRoute(
        path: AppRoutes.terminal,
        name: 'terminal',
        pageBuilder: (context, state) =>
            _buildPage(state: state, child: const TerminalScreen()),
      ),
      GoRoute(
        path: AppRoutes.settings,
        name: 'settings',
        pageBuilder: (context, state) =>
            _buildPage(state: state, child: const SettingsScreen()),
      ),
    ],
    redirect: (context, state) {
      final connectionState = ref.read(connectionProvider);
      final sessionState = ref.read(sessionProvider);
      final hasActiveLink = ref.read(sessionServiceProvider).activeLink != null;
      final currentPath = state.uri.path;

      // If user is navigating to terminal but there is no active session,
      // redirect to home so they can scan a new QR code.
      if (currentPath == AppRoutes.terminal) {
        final isConnected =
            connectionState == ConnectionStatus.connected ||
            connectionState == ConnectionStatus.connecting;
        final hasSession = sessionState != null;

        if (!isConnected && !hasSession && !hasActiveLink) {
          return AppRoutes.home;
        }
      }

      // No redirect needed.
      return null;
    },
    errorPageBuilder: (context, state) => _buildPage(
      state: state,
      child: _ErrorPage(error: state.error?.toString() ?? 'Unknown route'),
    ),
  );
});

/// Builds a page with a slide-up transition for modal screens (scan, settings)
/// and a fade transition for main screens.
CustomTransitionPage<void> _buildPage({
  required GoRouterState state,
  required Widget child,
}) {
  final isModal =
      state.uri.path == AppRoutes.scan || state.uri.path == AppRoutes.settings;

  if (isModal) {
    return CustomTransitionPage<void>(
      key: state.pageKey,
      child: child,
      transitionDuration: const Duration(milliseconds: 300),
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        return SlideTransition(
          position: Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero)
              .animate(
                CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
              ),
          child: child,
        );
      },
    );
  }

  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionDuration: const Duration(milliseconds: 200),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return FadeTransition(opacity: animation, child: child);
    },
  );
}

/// A [ChangeNotifier] that listens to Riverpod providers and notifies
/// the GoRouter to re-evaluate redirects when relevant state changes.
class _ConnectionStateListenable extends ChangeNotifier {
  _ConnectionStateListenable(this._ref) {
    // Watch connection state changes
    _ref.listen<ConnectionStatus>(connectionProvider, (previous, next) {
      if (previous != next) notifyListeners();
    });
  }

  final Ref _ref;
}

class _ErrorPage extends StatelessWidget {
  const _ErrorPage({required this.error});

  final String error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Navigation Error')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.error_outline,
                color: Color(0xFFFF5252),
                size: 48,
              ),
              const SizedBox(height: 16),
              Text(
                error,
                style: Theme.of(context).textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () => context.go(AppRoutes.home),
                child: const Text('Go Home'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
