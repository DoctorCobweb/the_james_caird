/*
 *
 *
 * THE_JAMES_CAIRD: a little app out in the ocean making mobile tickets
 * 
 */
//
//MODULE DEPENDENCIES:
var application_root = __dirname,
    express = require('express'),
    path = require('path'),
    format = require('util').format,
    fs = require('fs'),
    exec = require('child_process').exec,    
    https = require('https'),
    express_validator = require('express-validator'),
    AWS = require('aws-sdk'),
    moment = require('moment');



//setup AWS stuff
AWS.config.update({"accessKeyId": process.env.AWS_ACCESS_KEY_ID,
                   "secretAccessKey": process.env.AWS_SECRET_ACCESS_KEY,
                   "region": process.env.AWS_REGION,
                   "sslEnabled": true});


//The http server will listen to an appropriate port, or default to
//port 5001.
var port = process.env.PORT || 5001;
console.log('process.env.PORT: ' + process.env.PORT);


//create the express application. express() returns a Function designed to 
//be passed to nodes http/https servers as a callback to handle requests. 
var app = express();


//CONFIGURE SERVER:
app.configure(function () {
  app.use(express.bodyParser());
  app.use(express_validator());
  app.use(express.methodOverride());
  app.use(express.query());
  app.use(express.cookieParser('my secret string'));
  app.use(app.router);
  //express will use the first static path to foler it encounters. so when site_prod 
  //app.use call is uncommented it will use that & ignore site_dev static folder even 
  //when it is uncommented also (!)
  //uncomment this to use production, optimized, code from r.js process
  //app.use(express.static(path.join(application_root, 'site_prod')));

  //this sets the app to serve development code which is _not_ optimized 
  //app.use(express.static(path.join(application_root, 'site_dev')));

  app.use(express.errorHandler({dumpExceptions: true, showStack: true}));
});




// ################## ROUTE HANDLER #############################

app.get('/', function (req, res) {
  return res.send('hello there dude');
});



// ################## ROUTE HANDLER #############################

//create pkpasses for iphone users with iOS 6 +
app.get('/api/apple', function (req, res) {
  console.log('in the_james_caird app, GET /api/apple handler');
  console.log('req.query:');
  console.log(req.query); //should have gig and order id sent thru in querystring

  start_pkpass_generation(req, res, function (err) {
    if (err) {
      throw err;
    }
  });

});


//create a tmp dir. check if it already exists, if so then try another rand number
//nav into the tmp dir
//download all the contents of the S3 bucket pertaining to the gig
//create the pkpass
//upload it to S3 in the relevant gig dir, get url for clientside to download pkpass
//cleanup tmp dir by deleting it and the contents
//return the pkpass to user (or should it be a url)
//
//could u start the pkpass process from initialize() clientside and just return the 
//final url for downloading the pkpass to the button to call if pressed.
function start_pkpass_generation(req, res, callback) {
  var s3 = new AWS.S3();
  var random_int; 
  var MIN_RAND = 1000;
  var MAX_RAND = 9999;
  var extracted_keys = []; //array of items for download from s3 for gig
  var pass_name = 'testler' + '.pkpass';
  var WRK_DIR;
  var manifest_content = {};
  var PKPASS_NUMBER_OF_PNG_FILES = 6;
  var file_count = 0;
  var PKPASS_NUMBER_OF_FILES_IN_DIR= 9;


  //Returns a random integer between min and max
  //Using Math.round() will give you a non-uniform distribution!
  function get_random_int(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }


  function create_tmp_dir() {
    random_int = get_random_int(MIN_RAND, MAX_RAND);

    WRK_DIR = process.env.PWD + '/tmp' + random_int + '/';

    //check if the tmp dir already exists. if it does, another user is currently
    //generating their pkpass and you dont want to overwrite their pkpass details
    //method: try to read the dir. if err is non null in callback then the dir exists.
    //we want to have an err null which means the dir does _not_ exist.
    //fs.readdir(process.env.PWD + '/tmp' + random_int, function (err, files) {
    fs.readdir(WRK_DIR, function (err, files) {
      if (err) {
        //dir does not exist, cool. go onto the next step
        console.log(WRK_DIR + ' does not exist. GOOD');
   
        make_the_tmp_dir();
      } else {
        //dir does exist
        console.log(WRK_DIR + ' does exist. BAD, try another dir');

        //call this function again which will create a new random_int to use
        create_tmp_dir();
      }
    });
  }


  function make_the_tmp_dir() {

    fs.mkdir(WRK_DIR, function (err) {
      if (err) {
        console.log(err); 
        return callback(err);
      } else {
        console.log('making ' + WRK_DIR + '  dir');
  
        //now get the list of all the files from S3 for the gig in question
        get_the_list_of_files_from_s3();
      }
    });          
  }


  function get_the_list_of_files_from_s3() {
    var slash_index;
    var single_key;

    //list all the objects in the gig_id dir
    s3.listObjects({
        Bucket: process.env.AWS_S3_BUCKET_APPLE,
        Prefix: req.query.gig_id + '/'
      }, 
      function (err, data) {
        if (err) {
          return callback(err);
        } else {
          console.log('got a list of S3 objects for Bucket: ' 
                      + process.env.AWS_S3_BUCKET_APPLE);

          console.log(data);

          for (var i in data.Contents) {
            slash_index = (data.Contents[i].Key).indexOf('/');
            single_key = (data.Contents[i].Key).substring(slash_index + 1);
        
            //skip over any items which are empty or contain another slash ie. a sub
            //folder.
            if (single_key === '' || (single_key.indexOf('/') > -1 )) {
              continue;
            }             

            extracted_keys[i] = single_key;
          }


          //does the same thing as the continue statement above...
          /*
          for (var j in extracted_keys) {
            if (extracted_keys[j] === '' || (extracted_keys[j].indexOf('/') > -1 )) {
              delete extracted_keys[j];
            }             
          }
          */


          console.log('extracted keys array is:');
          console.log(extracted_keys);

          //got all the items in the S3 bucket for the gig we are after. now go and 
          //download them and write to the filesystem
          download_listed_files_from_s3();

        }
      }
    );
  }


  function download_listed_files_from_s3() {
 
    for (var k in extracted_keys) {
      console.log('getting an object from S3 called: ' + extracted_keys[k]);

      var params = {
          Bucket: process.env.AWS_S3_BUCKET_APPLE,
          Key: req.query.gig_id + '/' + extracted_keys[k]
      };

      var path_for_the_file = WRK_DIR + extracted_keys[k];


      //TODO: ERROR HANDLUNG for stream implementation
      //using pipes. this works but there's no ERRROR HANDLING!!!!!
      //console.log(path_for_the_file);
      //createReadStream(): the data read from the stream only contains the raw HTTP
      //_body_ contents.
      var file = fs.createWriteStream(path_for_the_file); 
      //s3.getObject(params).createReadStream().pipe(file);
      s3.getObject(params).createReadStream()
        .on('data', function (chunk) {
          console.log('S3 read stream: DATA EVENT');
        })
        .on('end', function () {
          console.log('S3 read stream: END EVENT');
          file_count++;
          console.log('file_count: ' + file_count);
          if (file_count === PKPASS_NUMBER_OF_FILES_IN_DIR) {
            console.log('calling make_the_pkpass() because we have all the files.');
            make_the_pkpass();
          }
        })
        .pipe(file);

    } //end for loop


    console.log('looking into the new dir for files...');
    fs.readdir('./tmp' + random_int, function (err, files) {
      if (err) {
        return callback(err);
      }

      for (var i in files) {
        console.log('files[' + i + ']' + files[i]);
      }

    });
  }



  function make_the_pkpass() {
    console.log('in make_the_pkpass()');
    var formatted_event_date =  moment(req.query.order_event_date).format("MMM Do YY");

    console.log('DATEEEEE: ' 
               + moment(req.query.order_event_date).format("MMM Do YY")
               );

    //save it to file
    //compute the hash 
    //add hash to manifest.json

    function construct_pass_json() {

      var the_message = req.query.order_id + '/////' +
                        req.query.order_first_name + '/////' +
                        req.query.order_last_name + '/////' +
                        req.query.order_main_event + '/////' +
                        req.query.order_number_of_tickets + '/////' +
                        req.query.order_transaction_status;


      //the extra custom stuff needed to make the unique pkpass
      var extra = "\"description\"" + ':' + 
                  "\"Admit" + req.query.order_number_of_tickets +  " for"   
                  + req.query.order_main_event + "\"" + "," +


                  "\"barcode\"" + ":" + "{" +
                      //"\"message\"" + ":" + "\"" + req.query.order_id + "\"" + "," +
                      "\"message\"" + ":" + "\"" + the_message + "\"" + "," +
                      "\"format\"" + ":" + "\"PKBarcodeFormatQR\"" + "," +
                      "\"messageEncoding\"" + ":" + "\"iso-8859-1\"" +
                  "}," +
                  "\"coupon\"" + ":" + "{" +
                      "\"primaryFields\"" + ":" + "[" +
                          "{" +
                              "\"key\"" + ":" + "\"offer\"" + "," +
                              "\"label\"" + ":" + "\"for " 
                                                + req.query.order_main_event 
                                                + "\"" + "," +
                              "\"value\"" + ":" + "\"Admit " 
                                                + req.query.order_number_of_tickets 
                                                + "\"" +
                          "}" +
                        "]," +
                     "\"secondaryFields\"" + ":" + "[" +   
                          "{" +
                              "\"key\"" + ":" + "\"second\"" + "," +
                              "\"label\"" + ":" + "\"VENUE \"," +
                              "\"value\"" + ":" + "\"" 
                                                + req.query.order_venue 
                                                + "\"" +
                          "}," +
                          "{" +
                              "\"key\"" + ":" + "\"third\"" + "," +
                              "\"label\"" + ":" + "\"DATE \"," +
                              "\"value\"" + ":" + "\"" 
                                                + formatted_event_date 
                                                + "\"" +
                          "}" +
//this doesnt fit for a coupon style pkpass...
/*
                          "{" +
                              "\"key\"" + ":" + "\"fourth\"" + "," +
                              "\"label\"" + ":" + "\"DOORS \"," +
                              "\"value\"" + ":" + "\"" 
                                                + req.query.order_opening_time 
                                                + "\"" +
                          "}" +
*/
                     "]" +
                  "}" +
               "}";

      //complete the pass.json file
      //must close the files on error and when success finished writing to it.
      fs.appendFile(WRK_DIR + 'pass.json', extra, function (err) {
        if (err) { return callback(err); }    
        console.log('appended the extra stuff to pass.json');

        hash_pass_json();
      });

    } //end construct_pass_json



    function hash_pass_json() {
      //compute hash of pass.json file
      console.log('computing the sha1 hash of pass.json...');
      exec('openssl sha1 pass.json', {cwd: WRK_DIR}, function(err, stdout, stderr){
        if(!err) {
          console.log('computed the sha1 hash of pass.json');

          var content = stdout;
          var start_index_of_hash = content.indexOf('=') + 2
          var hash = content.substring(start_index_of_hash, content.length - 1);

          //put the (pass.json, hash) pair into the manifest_content object
          manifest_content["pass.json"] = hash;
        
          compute_hash_of_image_files();
        } else {
          console.log(req.query.order_id + '.pkpass: '
                      + 'OPENSSL_ERROR: Unable to sha1 pass.json file.' + err);
        }
      });
    }  





    //ERRORS occur when using the tmpxxxx dir. but everything works when you use a prior
    //made dir (even with the Certificates.p12 and WWDR.pem copied from a previous S3 
    //download => it is not the certs authenticity).
    //ANSWER: it is because of the async nature of nodejs: it races though the function
    //call chain and tries to use Certificates.p12 (and all the other files it's trying
    //to download for that matter) before they are completely downloaded!
    //hacky fix is currently using setTimeout for 2000ms.
    //but a better fix would be to listen to data and end events for the streams.
    //if u keep with using the setTmeout hack, then what happens if the downloading takes
    //more than the timout intervel? you will go on to use incomplete files (not really
    //fixing the issue are you!).
    //var wrk_dir ='./tmp' + random_int + '/';
    //var wrk_dir ='./a_debugging_pkpass/';


    function compute_hash_of_image_files() {
      //-------------------------------------------------------------------------
      //BUG?: what happens if manifest.json has not been completely created
      //and the .pkpass routines finish before that? incomplete manifest.json
      //file -> invalid pass! callback embedding of these 2 procedures..?
      //create the manifest.json file programatically
      fs.readdir(WRK_DIR, function(err, names){
  
  
        console.log(req.query.order_id + '.pkpass: ' 
                    + 'The current directory contains image files:');
  
        //compute sha1 hash of all .png files
        for(var i = 0; i < names.length; i++) {
          if (names[i].indexOf('.png') >= 0) {
            console.log(req.query.order_id + '.pkpass: ' +  names[i]);
  
            //used to call next step, openssl_step(), AFTER, the for-loop has gone 
            //through and found all .png files.
            //a way to handle async callbacks happen waaayyyy later than the for-loop
            //finishing.
            var count = 0;
  
            exec('openssl sha1 ' + names[i], {cwd: WRK_DIR}, 
              function(err, stdout, stderr){
  
                if(!err) {
                  //console.log('stdout: ' + stdout);
                  //console.log('names: ' + names[i]);
     
                  var content = stdout;
                  var start_index_of_hash = content.indexOf('=') + 2
                  var left_brace = content.indexOf('(');
                  var right_brace = content.indexOf(')');
     
                  //also, strip the newline character from end of hash.
                  var hash = content.substring(start_index_of_hash, content.length - 1);
                  var file_name = content.substring(left_brace + 1, right_brace);
     
                  //put the (file_name, hash) pair into the manifest_content obj.
                  manifest_content[file_name] = hash;
     
                  console.log(req.query.order_id + '.pkpass' 
                    + ' manifest_content.' + file_name + '=' 
                    + manifest_content[file_name]);
     
                  fs.writeFile( WRK_DIR + 'manifest.json', 
                    JSON.stringify(manifest_content),
                    function(err){
                      if (err) {
                        throw err;
                      } else {
                        console.log('Pkpass:[' + req.query.gig_id
                          + ']' + 'FILE_SAVED: manifest.json');
    
                        count++;
                        console.log('count: ' + count);
                        if (count === PKPASS_NUMBER_OF_PNG_FILES) {
                          //we have written all the .png files to disk, now we can go to 
                          //next step
                          openssl_step();
                        }
    
                      } 
                    }
                  ); 
                } else {
                  console.log(req.query.order_id + '.pkpass: ' 
                              + 'OPENSSL_ERROR: Unable to sha1 ' + names[i] + ' file.');
                }
              } //end exec callback
            ); //end exec sha1 for .png files
          } //end if-names end in .png
        } //end for-loop
      }); //end fs.readdir
    } //end compute_hash_of_image_files


    //start the function calls
    //hash_pass_json();
    construct_pass_json();

  } //end make_the_pkpass()




  function openssl_step() {
    console.log('in openssl_step()');


    //statements used in the pkpass openssl chain
    var openssl_stmt_1 = "openssl pkcs12 -in Certificates.p12 " 
                         + "-clcerts -nokeys -out passcertificate.pem -passin pass:";

    var openssl_stmt_2 =  "openssl pkcs12 -in Certificates.p12 "
                          + "-nocerts -out passkey.pem -passin "
                          + "pass: -passout pass:12345";

    var openssl_stmt_3 = "openssl smime -binary -sign -certfile WWDR.pem "
                         + "-signer passcertificate.pem -inkey passkey.pem "
                         + "-in manifest.json -out signature -outform "
                         + "DER -passin pass:12345";

    //c for create archive, f for filename called pass_name, M for DONT create the jar
    //manifest file META-INF/MANIFEST.INF
    var openssl_stmt_4   = "jar cfM " + pass_name 
    //var openssl_stmt_4   = "zip -r " + pass_name 
                         + " manifest.json pass.json signature "
                         + "logo.png logo@2x.png icon.png icon@2x.png "
                         + "strip.png strip@2x.png";

    //var openssl_stmt_4_dev   = "zip -r " + pass_name 
    //                     + " manifest.json pass.json signature "
    //                     + "logo.png logo@2x.png icon.png icon@2x.png "
    //                     + "strip.png strip@2x.png";

    //--------------------------------------------------------------------------
    //create a .pkpass pass using Openssl and  Certificates.p12, WWDR.pem files
    //export Certificates.p12 into a different format, passcertificate.pem
    exec(openssl_stmt_1 , {cwd: WRK_DIR}, function(err, stdout, stderr){
      if(!err){
        var content = stdout;
        console.log(req.query.order_id + '.pkpass: ' 
                    + 'OPENSSL_SUCCESS: Certificates.p12 -> passcertificate.pem');


        //export the key as a separate file, passkey.pem
        exec(openssl_stmt_2, {cwd: WRK_DIR}, function(err, stdout, stderr){
          if(!err){
            var content = stdout;
            console.log(req.query.order_id + '.pkpass: '
                        + 'OPENSSL_SUCCESS: Certificates.p12 -> passkey.pem');


            //create the signature file.
            exec(openssl_stmt_3, {cwd: WRK_DIR}, function(err, stdout, stderr){
              if(!err){
                var content = stdout;
                console.log(req.query.order_id + '.pkpass: '
                            + 'OPENSSL_SUCCESS: Created the signature file.');


                //finally, create the .pkpass zip file, freehugcoupon.pkpass
                exec(openssl_stmt_4, {cwd: WRK_DIR}, function(err, stdout, stderr){
                  if(!err){
                    var content = stdout;
                    console.log(req.query.order_id + '.pkpass: ' + stdout);
                    console.log(req.query.order_id + '.pkpass: '
                      + 'ZIP_SUCCESS: Created the .pkpass file.');


                    //TODO
                    //dont use exists. see nodejs docs -> leads to race conditions
                    //check to see if the file exists before downloading.
                    fs.exists( WRK_DIR + pass_name, function(exists){
                      if (exists){

                        var key_url = req.query.gig_id + '/final_pkpasses/' 
                                                  + req.query.order_id
                                                  + '.pkpass';
                        console.log('key_url: ' + key_url);


                        //we return the .pkpass file make on the emphemeral fs. NOT the
                        //aws saved version of it.
                        console.log('WRK_DIR + pass_name: ' + WRK_DIR + pass_name);
                    

                        //no need to set the header here, do it from shackleton app
                        //res.contentType('application/vnd.apple.pkpass');
                        res.sendfile(WRK_DIR + pass_name, function (err) {
                          if (err) {
                            return callback(err);
                          } else {
                            console.log('putting ' + req.query.order_id 
                                        + '.pkpass into S3......');
                                        
    
                            //upload the pkpass to S3 since it is finished and exists
                            s3.putObject({
                                Bucket: process.env.AWS_S3_BUCKET_APPLE,
                                Key: key_url,
                                Body: fs.createReadStream(WRK_DIR + pass_name)
                              }, 
                              function (err, data) {
                                if(err) {
                                  return callback(err);
                                } else {
                                  console.log('data from s3.putObject callback');
                                  console.log(data);
    
    
                                  var params = {
                                    Bucket: process.env.AWS_S3_BUCKET_APPLE, 
                                    Key: req.query.gig_id + '/final_pkpasses/' + 
                                         req.query.order_id + '.pkpass' 
                                  };
                                  var url = s3.getSignedUrl('getObject', params);
                                  console.log('Got an AWS signed url', url);

    
                                  //SYNC HACK. does it intro bug?
                                  var files_in_tmp = [];
                                  console.log('reading tmp dir');
                                  files_in_tmp = fs.readdirSync(WRK_DIR);
                                  console.log('deleting the files in tmp dir');
                                    
                                  for (var l in files_in_tmp) {
                                    console.log(files_in_tmp[l]);
                                    fs.unlinkSync(WRK_DIR + files_in_tmp[l]);
                                  }
                                  console.log('deleting tmp dir');
                                  fs.rmdirSync(WRK_DIR);

    
                                }
                              }
                            );


                          }
                        });


                        //you must set the mime type for the content to respond with
                        //so safari can recognize it.
                        //does this also work for other mobile browsers?
                        //e.g. mobile chrome browser on iphone?
                        //res.contentType('application/vnd.apple.pkpass');

                        //DELIVER THE FINAL PRODUCT: the pass !!!
                        //res.download( WRK_DIR + pass_name);

                      } else {
                        console.log(req.query.order_id + '.pkpass: ' 
                                    + pass_name + ' does not exist, yet.');
                      }
                    });
                  } else {
                   
                    console.log(req.query.order_id + '.pkpass: '
                                + 'ZIP_ERROR: Could not create the .pkpass file.');
                    console.log(err);
                  }
                }); //end zip exec
              } else {
                console.log(req.query.order_id + '.pkpass: ' 
                            + 'OPENSSL_ERROR: Could not make signature file.');
                console.log(err);
              }
            });
          } else {
            console.log(req.query.order_id + '.pkpass: '
                        + 'OPENSSL_ERROR: Could not make passkey.pem');
            console.log(err);
          }
        });
      } else {
        console.log(req.query.order_id + '.pkpass: '
          + 'OPENSSL_ERROR: Could not make passcertificate.pem'+ stderr);
      }

    }); //end exec('openssl ......stuff')


  } //openssl_step()




  //start the function call chain
  create_tmp_dir();

} //end start_pkpass_generation function



//START %%%%%%%%%%% JUNK-STAGING AREA %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
/*
  s3.createBucket({Bucket: process.env.AWS_S3_BUCKET_APPLE}, function (err, data) {
    if (err) {
      console.log(err);
    } else {
      console.log(data);
      s3.putObject({
          Bucket: process.env.AWS_S3_BUCKET_APPLE,
          Key:    'gig_id',
          Body:   req.query.gig 
        },
        function (err, data) {
          if (err) {
            console.log(err); 
          } else {
            console.log(data);
          }
      });
    }
  });


  //list all the S3 buckets
  s3.listBuckets(function(err, data) {
    console.log('=====> getting the list of all S3 buckets...');
    for (var index in data.Buckets) {
      var bucket = data.Buckets[index];
      console.log("Bucket: ", bucket.Name, ' : ', bucket.CreationDate);
    }
});
*/
//END %%%%%%%%%%% JUNK-STAGING AREA %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%





//start the actual http server
app.listen(port, function () {
 console.log('HTTP Express server listening on port %d in %s mode', 
   port, app.settings.env);
});
