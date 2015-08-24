/*jslint node: true */
/*jslint es5: true */
/*jslint nomen: true */
/*global setImmediate */

"use strict";

var wapi = require('./lib/winapi'),
    rwcsv = require('./lib/rwcsv'),
    fs = require('graceful-fs'),
    path = require('path'),
    argv = require('yargs'),
    async = require('async'),
    moment = require('moment'),
    settings,
    win,
    outDir,
    dumps,
    work = [],
    done = {report: [], count: { xml: 0, json: 0}},
    timeinc,
    FORMATS = {xml: "asXML", json: "asJSON"},
    PERIODS = {week: 7, day: 1},
    PUBSTATES = {all: "ignorePublished", pub: "published" },

    //TODO there should be a dynamic way to retrieve these lists
    PRODUCTS = ['accommodation', 'permanent_offering', 'reca', 'temporary_offering', 'meetingroom'],
    // TODO when channels are automatic --> try to recognise that lang-variants can be grouped into one!
    // --> just match for _nl , then add also the variant without _nl
    CHANNELS = ['westtoer', 'fietsen_en_wandelen', 'kenniscentrum', 'dagtrips_voor_groepen',
                'flanders_fields', 'flanders_fields_nl', 'flanders_fields_fr', 'flanders_fields_en', 'flanders_fields_de',
                'leiestreek', 'leiestreek_nl', 'leiestreek_fr', 'leiestreek_en', 'leiestreek_de',
                'de_kust', 'de_kust_nl', 'de_kust_en', 'de_kust_fr', 'de_kust_de',
                'brugse_ommeland', 'brugse_ommeland_nl', 'brugse_ommeland_fr', 'brugse_ommeland_de', 'brugse_ommeland_en',
                'westhoek', 'westhoek_nl', 'westhoek_fr',
                'meetingkust', 'meetingkust_nl', 'meetingkust_fr',
                '300_jaar_grens', '300_jaar_grens_nl', '300_jaar_grens_fr', '300_jaar_grens_en', '300_jaar_grens_de',
                'autoroutes', 'itrip_coast', 'kustwandelroute', 'west-vlinderen', 'iedereen_flandrien'],
    TOURTYPES = ["aanlegplaats", "adventure", "andere", "attractiepark", "battle_field_tour", "begraafplaats_amerikaans", "begraafplaats_belgisch",
             "begraafplaats_commonwealth", "begraafplaats_duits", "begraafplaats_frans", "belfort", "bezoekerscentrum", "bioscoop",
             "bistro", "bootverhuur", "bos", "brouwerij", "cafe", "camping", "casino", "concert", "cultureel_centrum", "domein",
             "festival", "fietsen", "fietsverhuur", "film", "frontvlucht", "gastenkamer", "golf", "herdenkingsplechtigheid",
             "historisch_gebouw", "hoeve_om_te_proeven", "hotel", "huifkartocht", "ijspiste", "jachthaven", "jeugdverblijf",
             "kampeerautoterrein", "kampeerhut", "kano_kajak_verhuur", "kinderboerderij", "manege", "minicamping", "monument",
             "museum", "onbepaald", "oorlogssite", "park_tuin", "pretpark", "religieus_gebouw", "restaurant",
             "scooter_solex_verhuur", "shopping", "shop_winkel", "speciale_markt", "speeltuin", "sportaccommodatie",
             "sportwedstrijd", "stoet", "stokerij", "strandclub", "tearoom", "tentoonstelling", "theater", "toeristische_dienst",
             "vakantiecentrum", "vakantielogies", "vakantiepark", "vakantiewoning", "verblijfpark", "vuurwerk", "wandelen",
             "waterrecreatie", "wekelijkse_markt", "wellness", "wijngaard", "zaal", "zwemgelegenheid"];

settings = argv
    .usage('Maakt een dump op basis van de win2 API.\nUsage: $0')
    .example('$0  -o ~/feeds/win/2.0/ -s secret [dumpspecs*]',
             'Maakt de product-dump van de gekozen categoriën (dumpspecs) en plaatst die in de aangegeven output-folder.\n' +
             'Wanneer geen dumps worden gedspecifieerd worden "products vocs samples" verondersteld.\n' +
             'Numerieke dumpspecs worden aanzien als "id" van de uniek op te halen items.\n' +
             'Let op: de dump van "token" is exclusief al de andere en retourneert gewoon snel een accesstoken dan 1h lang gebruikt kan worden.')

    .describe('clientid', 'id of the client - requires matching secret')
    .alias('i', 'clientid')

    .describe('secret', 'het secret.')
    .alias('s', 'secret')

    .describe('output', 'folder waar de dump wordt geplaatst.')
    .alias('o', 'output')

    .describe('verbose', 'should there be a lot of logging output')
    .alias('v', 'verbose')
    .default('v', false)

    .describe('progress', 'should there be a logging of the progress')
    .alias('p', 'progress')
    .default('p', false)

    .describe('timebetween', 'wait this many millis between requests')
    .alias('t', 'timebetween')
    .default('t', 100)  //10 requests per second

    .demand(['secret', 'output'])

    .argv;

win = wapi.client({secret: settings.secret, clientid: settings.clientid, verbose: settings.verbose});
outDir = settings.output;
timeinc = settings.timebetween;
dumps = settings._ && settings._.length ? settings._ : ['products', 'vocs', 'samples'];


function contains(arr, item) {
    return (arr.indexOf(item) >= 0);
}

function addTask(task) {
    work.push(task);
}

function nameJoin() {
    return [].reduce.call(arguments, function (name, part) { return (name.length ? name + "-" : "") + part; }, "");
}


function reportDone(ext, task, status, uri, ts_start, open_start, size, mime) {
    var ts_end = moment(), open_end, duration;

    done.count[ext] += 1;
    work.open -= 1;

    open_end = work.open;
    duration = ts_end.diff(ts_start);

    done.report.push([
        ts_start.toISOString(),
        ts_end.toISOString(),
        duration,
        task.dir,
        task.name + "." + ext,
        task.query.resources.join('|'),
        task.query.touristictypes.join('|'),
        task.query.channels.join('|'),
        task.query.lastmodRange ? task.query.lastmodRange.gte : "",
        task.query.softDelState,
        task.query.pubState,
        status, uri,
        open_start, open_end, size, mime
    ]);
    
    if (settings.progress) {
        console.log("done xml %d - json %d off %d \t- open connections == %d > %d \t- size %d \t- mime = %s",
                    done.count.xml, done.count.json, work.length, open_start, open_end, size, mime);
    }

    if (done.count.xml === work.length && done.count.xml === done.count.json) {
        rwcsv.write(
            path.join(outDir, "dhubdump-report.csv"),
            done.report,
            [
                "ts_start", "ts_end", "duration (ms)", "dir", "name", "types", " touristic_types", "channels",
                "lastmod GTE", "softDelState", "pubState", "status", "uri",
                "open on start", "open on close", "content-length", "content-type"
            ]
        );
    }
}

function remove(fname) {
    if (fs.existsSync(fname)) {
        fs.unlinkSync(fname);
    }
}

function size(fname) {
    if (!fs.existsSync(fname)) {
        return -1;
    } // else
    return fs.statSync(fname).size;
}

function perform(task) {
    
    var q = task.query,
        pathname = path.join(outDir, task.dir, task.name);


    Object.keys(FORMATS).forEach(function (ext) {
        var status, fmtMethod = FORMATS[ext],
            fname = [pathname, ext].join('.'),
            ts, open, uri,
            sink = fs.createWriteStream(fname), qbf;

        sink.on('error', function (e) {
            remove(fname);
            status = "error :" + e;
            console.error("error saving " + pathname + "." + ext + "-->" + e);
        });

        qbf = q.clone().bulk()[fmtMethod]();
        uri = qbf.getURI(win, true);
        ts = moment();
        open = work.open;

        work.open += 1;
        win.stream(qbf, sink, function (res) {
            if (status === undefined) {
                //wait for completion to be able to size the file.
                //this because apparently there is no content-length header
                res.on('end', function () {
                    reportDone(ext, task, "ok", uri, ts, open, size(fname), res.headers['content-type']);
                });
            } else {
                reportDone(ext, task, status, uri, ts, open, -1, "");
            }
        });
    });
    
}

function makePeriodTasks(pTask) {
    var to = moment();
    return function (period) {
        var days = PERIODS[period],
            from = to.clone().subtract(days, 'days'),
            task = {dir  : pTask.dir,
                    name : nameJoin(pTask.name, period, from.format('YYYYMMDD'), 'current'),
                    query: pTask.query.clone().lastmodBetween(from, null)};
        addTask(task);
    };
}

function makePubTasks(pTask) {
    return function (pubKey) {
        var pubMethod = PUBSTATES[pubKey],
            task = {dir  : pTask.dir,
                    name : nameJoin(pTask.name, pubKey),
                    query: pTask.query.clone()[pubMethod]()};
        addTask(task);
        Object.keys(PERIODS).forEach(makePeriodTasks(task));
    };
}

function assertDirExists(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

function makeTourTypeTasks(pTask) {
    var dir  = path.join(pTask.dir, "bytourtype");
    assertDirExists(path.join(outDir, dir));
    return function (tourtype) {
        var dir  = path.join(pTask.dir, "bytourtype"), //tourtype),
            task = {dir  : dir,
                    name : nameJoin(pTask.name, tourtype),
                    query: pTask.query.clone().forTouristicTypes(tourtype)};

        addTask(task);
        Object.keys(PERIODS).forEach(makePeriodTasks(task));
    };
}

function makeChannelTasks(pTask) {
    assertDirExists(path.join(outDir, pTask.dir, "bychannel"));
    return function (channel) {
        var dir  = path.join(pTask.dir, "bychannel", channel),
            task = {dir  : dir,
                    name : nameJoin(pTask.name, channel, "all"),
                    query: pTask.query.clone().forTypes(PRODUCTS).forChannels(channel + ".*")};

        assertDirExists(path.join(outDir, dir));

        addTask(task);
        Object.keys(PERIODS).forEach(makePeriodTasks(task));

        //simplify name downwards -
        task.name = nameJoin(pTask.name, channel);
        TOURTYPES.forEach(makeTourTypeTasks(task));
    };
}

function makeProductTasks(pTask) {
    return function (prod) {
        var task = {dir  : pTask.dir,
                    name : prod,
                    query: pTask.query.clone().forTypes(prod)};
        Object.keys(PUBSTATES).forEach(makePubTasks(task));
    };
}

function makeClaimsDump() {
    var task = {
        dir: ".",
        name: "claims",
        query: wapi.query('claim').requireFields(["claims.claim.owner.email_address", "partner_id"])
    };

    addTask(task);
}

function makeVocDump() {
    var task = {
        dir: "reference",
        name: "taxonomies",
        query: wapi.query('vocabulary')
    };
    assertDirExists(path.join(outDir, task.dir));
    addTask(task);
}

function makeIdTask(pTask) {
    return function (id) {
        var task = {dir  : pTask.dir,
                    name : nameJoin(pTask.name, id),
                    query: pTask.query.clone().id(id)};
        addTask(task);
    };
}

function makeSingleIdDump(id) {
    var task = {
        dir: "samples",
        name: "item",
        query: wapi.query('product').forTypes(PRODUCTS).id(id)
    };
    assertDirExists(path.join(outDir, task.dir));
    makeIdTask(task)(id);
}

function makeSampleIdsDump() {
    var SAMPLEIDS = [33346, 53249, 53302, 53303, 53304, 53306, 53307, 53308, 53309, 53310, 53311, 53312, 53313, 53314, 53315, 53381, 53382, 53383, 53384],
        task = {
            dir: "samples",
            name: "sample",
            query: wapi.query('product').forTypes(PRODUCTS)
        };

    assertDirExists(path.join(outDir, task.dir));
    SAMPLEIDS.forEach(makeIdTask(task));
}

function makeProductsDump() {
    var task = {
        dir: ".",
        name: "",
        query: wapi.query('product')
    };

    // vocabulary lists
    // TODO --> but how do we know all vocabularies? for now, just hardcode (based omn shmdoc listings)

    //subtasks per products
    PRODUCTS.forEach(makeProductTasks(task));

    //subtasks per channel
    CHANNELS.forEach(makeChannelTasks(task));

    //subtask for all channels together
    task.name = "allchannels";
    task.query = task.query.clone().forTypes(PRODUCTS);
    TOURTYPES.forEach(makeTourTypeTasks(task));
}

function loadReferences(done) {
    var channels, types;

    function getChannels(cb) {

        //TODO perform logic to get list of channels from vocabulary
        // channels voc is a hierarchy but we want group levels as well --> we assume .* will work --> warn if not
        setImmediate(function () {
            cb(null, "");
        });
    }

    function getTypes(cb) {

        //TODO perform logic to get list of low-level-types from vocabulary
        // tourtypes voc is a hierachy but we only want lowest levels
        setImmediate(function () {
            cb(null, "");
        });
    }

    async.parallel([getChannels, getTypes], function (err, result) {
        done();
    });
    return;
}

function assembleWork() {
    dumps.forEach(function (d) {
        // decide which dump-tasks to add...
        if (d === 'products') {
            makeProductsDump();
        } else if (d === 'claims') {
            makeClaimsDump();
        } else if (d === 'vocs') {
            makeVocDump();
//            } else if (d === 'stats') {
//                makeStatsDump();
        } else if (d === 'samples') {
            makeSampleIdsDump();
        } else if (!isNaN(Number(d))) {
            makeSingleIdDump(d);
        }
    });
}

function doWork(done) {
    var cnt = 0;
    work.open = 0;
    function doNext() {
        if (cnt < work.length) {
            // process next
            perform(work[cnt]);
            cnt += 1;
            setTimeout(doNext, timeinc);
        } else {
            done();
        }
    }

    doNext();
}


function doDump() {

    // decide what to do
    if (contains(dumps, 'token')) {
        console.log('token');
        win.start(function () {
            console.log("token = %s", win.token);
            win.stop();
        });
        return; // if we request a token, do nothing else!
    } //else

    if (!fs.existsSync(outDir)) {
        throw "Cannot dump to " + outDir + " - path does not exist.";
    }
    if (!fs.statSync(outDir).isDirectory()) {
        throw "Cannot dump to " + outDir + " - path is not a directory.";
    }

    win.start(function () {
        loadReferences(function () {
            assembleWork();
            doWork(function () {win.stop(); });
        });
    });
}

doDump();
