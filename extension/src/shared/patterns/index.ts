/**
 * Design Patterns Module
 *
 * Common design patterns for the RubyMate extension.
 */

// Strategy Pattern
export {
    SearchStrategy,
    ExactSearchStrategy,
    PrefixSearchStrategy,
    ContainsSearchStrategy,
    FuzzySearchStrategy,
    FuzzySearchOptions,
    RegexSearchStrategy,
    CamelCaseSearchStrategy,
    SymbolSearcher
} from './searchStrategy';

// Observer Pattern
export {
    IndexObserver,
    IndexManager,
    IndexManagerOptions,
    BaseIndexObserver,
    FileChangeEvent,
    FileChangeType
} from './indexObserver';

// Flyweight Pattern
export {
    StringPool,
    StringPoolOptions,
    LocationPool,
    OptimizedSymbolFactory,
    ObjectPool,
    ArrayPool,
    getGlobalStringPool,
    getGlobalSymbolFactory,
    resetGlobalPools,
    disposeGlobalPools
} from './flyweight';

// Factory Pattern
export {
    ProviderFactory,
    ProviderConfig,
    ProviderConfigBuilder,
    ProviderRegistration,
    ProviderType,
    LanguageSelectors,
    TriggerCharacters
} from './providerFactory';

// Command Pattern
export {
    Command,
    CommandResult,
    BaseCommand,
    RenameSymbolCommand,
    ExtractMethodCommand,
    CompositeCommand,
    CommandHistory,
    CommandInvoker
} from './command';

// State Machine Pattern
export {
    StateMachine,
    StateConfig,
    StateDefinition,
    StateTransition,
    TransitionCallback,
    StateCallback,
    ParserState,
    ParserEvent,
    IndexerState,
    IndexerEvent,
    ConnectionState,
    ConnectionEvent,
    createParserStateMachine,
    createIndexerStateMachine,
    createConnectionStateMachine
} from './stateMachine';

// Visitor Pattern
export {
    Visitor,
    BaseVisitor,
    CollectorVisitor,
    RubyASTVisitor,
    SymbolCollectorVisitor,
    MethodCallCollectorVisitor,
    DependencyCollectorVisitor,
    ASTNode,
    RubyNode,
    SourcePosition,
    TraversalOptions,
    TraversalOrder,
    CollectedSymbol,
    CollectedMethodCall,
    CollectedDependency,
    traverseAST,
    findNodes,
    findNode,
    findNodeAtPosition
} from './visitor';

// Chain of Responsibility Pattern
export {
    Handler,
    HandlerFunction,
    BaseHandler,
    HandlerChain,
    HandlerChainOptions,
    PriorityHandler,
    PriorityHandlerChain,
    ConditionalHandler,
    FallbackHandler,
    CachingHandler,
    RetryHandler
} from './chainOfResponsibility';

// Decorator Pattern
export {
    Decorator,
    MetricsData,
    MetricsCollector,
    SimpleMetricsCollector,
    LoggerFn,
    DecoratorCache,
    TTLCache,
    DecoratorOptions,
    DecoratorBuilder,
    decorate,
    withCaching,
    withLogging,
    withMetrics,
    withTimeout,
    withRetry,
    withThrottle
} from './decorator';
